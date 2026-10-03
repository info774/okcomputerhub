// Piezas de Oki que se usan en DOS sitios: la portada (vista.ts) y los
// widgets movibles del modo escritorio (shell/escritorio.ts). Pueden estar a
// la vez en pantalla (la portada en una ventana y los widgets en el
// escritorio), así que nada va por id: la voz se agrupa con `data-voz="<grupo>"`
// y lo demás se pinta en el contenedor que se le pase.
import { API } from '../../core/api';
import { ir } from '../../core/router';
import { registrarAcciones } from '../../core/dispatcher';
import { llamarFuncion } from '../../core/funciones';
import { grabando, grabarYTranscribir, pararGrabacion, puedeDictar } from '../../ui/dictado';
import { esc, toast } from '../../ui/dom';

export interface Aviso {
  clave: string; tipo: string; gravedad: 'mal' | 'aviso' | 'info'; titulo: string; detalle: string | null;
  enlace: string | null; dinero: boolean;
}
interface TicketMin {
  id: string; estado: string; created_at: string; cerrado_at: string | null;
  sla_respuesta_at: string | null; primera_respuesta_at: string | null;
}

const ORDEN = { mal: 0, aviso: 1, info: 2 } as const;
export const hrefAviso = (a: Aviso) => (a.enlace?.startsWith('#/') ? a.enlace : '#/direccion');
/** Los que necesitan a una persona (sin los informativos), lo más grave primero. */
export const urgentesDe = (avisos: Aviso[]) => [...avisos].sort((a, b) => ORDEN[a.gravedad] - ORDEN[b.gravedad]).filter(a => a.gravedad !== 'info');

// ── Órdenes rápidas ─────────────────────────────────────────────────────────
const ORDENES: { t: string; href?: string; accion?: string }[] = [
  { t: 'Mi lista de hoy', href: '#/lista-dia' },
  { t: 'Nuevo trabajo', href: '#/trabajos/nuevo' },
  { t: 'Nuevo ticket', href: '#/tickets/nuevo' },
  { t: 'Repartir una comanda', href: '#/comandas' },
  { t: 'Planificar la semana', href: '#/calendario' },
  { t: 'Preguntar a Oki', accion: 'abrirBuscador' },
];
export const ordenesHTML = () => ORDENES.map(o => o.href
  ? `<a class="ok-orden" href="${o.href}"><span aria-hidden="true">›</span>${esc(o.t)}</a>`
  : `<button type="button" class="ok-orden" data-action="${o.accion}"><span aria-hidden="true">›</span>${esc(o.t)}</button>`).join('');

// ── Oki dice ────────────────────────────────────────────────────────────────
// Lo más urgente. Si es un ticket, Oki se ofrece a redactar la respuesta
// (#/tickets/<n>/responder): la redacta y una persona la manda.
export function diceHTML(urgentes: Aviso[]): string {
  const primero = urgentes[0];
  const ticket = primero?.enlace?.match(/^#\/tickets\/(\d+)$/)?.[1];
  return `
    <button type="button" class="ok-dice-btn" data-action="abrirBuscador" aria-label="Preguntar a Oki">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
    <div class="ok-dice-txt">
      <span class="ok-dice-et">Oki dice</span>
      <p>${primero
        ? `Hay ${urgentes.length === 1 ? 'una cosa que necesita' : `${urgentes.length} cosas que necesitan`} a una persona. Lo más urgente: <b>${esc(primero.titulo)}</b>${primero.detalle ? ` — ${esc(primero.detalle)}` : ''}.${ticket ? ' ¿Te redacto la respuesta?' : ''}`
        : 'Todo en orden: no hay nada pendiente que necesite a una persona.'}</p>
      <div class="acciones">
        ${ticket ? `<a class="btn" href="#/tickets/${ticket}/responder">Sí, contéstalo</a><a class="btn secundario" href="#/tickets/${ticket}">Lo miro yo</a>`
          : primero ? `<a class="btn" href="${esc(hrefAviso(primero))}">Ir a lo más urgente</a>` : ''}
        <a class="btn secundario" href="#/direccion">Ver todos los avisos</a>
      </div>
    </div>`;
}

// ── Estadísticas del Desk (y trabajos) de la semana ─────────────────────────
function lunes(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
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

/** Pinta las estadísticas DENTRO de `el`, después de `cab` (su cabecera). */
export async function pintarEstadisticas(el: HTMLElement, cab: string) {
  const ini = lunes();
  const hace30 = new Date(Date.now() - 30 * 86400000);
  const [{ data, error }, completados] = await Promise.all([API.get<TicketMin[]>('tickets', {
    select: 'id,estado,created_at,cerrado_at,sla_respuesta_at,primera_respuesta_at',
    or: `(created_at.gte.${hace30.toISOString()},cerrado_at.gte.${ini.toISOString()})`, limit: '2000',
  }), trabajosCompletados(ini)]);
  if (!el.isConnected) return;
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
    <div class="ok-fila-dato ok-dato-cerrados"><span>Tickets cerrados</span><b>${cerrados.length}</b></div>
    <div class="ok-fila-dato"><span>Tickets nuevos</span><b>${nuevos}</b></div>
    <a class="ok-fila-dato" href="#/trabajos"><span>Trabajos completados</span><b>${completados ?? '—'}</b></a>
    <div class="ok-barras" role="img" aria-label="Tickets cerrados por día esta semana: ${porDia.map((n, i) => `${'LMXJVSD'[i]} ${n}`).join(', ')}">
      <span class="ok-barras-tit">Tickets cerrados por día</span>
      <div class="ok-barras-fila">${porDia.map((n, i) => `<div class="ok-barra${i === hoyIdx ? ' hoy' : ''}">
        <small>${i > hoyIdx ? '' : n}</small><span style="--h:${i > hoyIdx ? 0 : Math.max(2, n / max * 100)}%"></span><em>${'LMXJVSD'[i]}</em></div>`).join('')}</div>
    </div>`;
}

// ── Voz de Oki ──────────────────────────────────────────────────────────────
// Un GRUPO es un sitio desde el que se habla (la portada con su barra del pie,
// el widget del escritorio): el estado y el resultado se pintan en los
// elementos con `data-voz="<grupo>"`.

/** La onda del micrófono: barras de alto y retraso fijos (se mueve con CSS). */
export function ola(n: number): string {
  return Array.from({ length: n }, (_, i) => `<span style="--h:${30 + ((i * 37) % 70)}%;animation-delay:${((i * 0.13) % 1.2).toFixed(2)}s"></span>`).join('');
}

/** El panel «Voz de Oki»: onda, estado, el hexágono para hablar y el resultado. */
export function vozHTML(grupo: string, cab: string): string {
  const puede = puedeDictar();
  return `${cab}
    <div class="ok-ola" aria-hidden="true">${ola(24)}</div>
    <p class="ok-voz-estado" data-voz="${grupo}" aria-live="polite">${puede ? 'Pulsa para hablar' : 'Este navegador no deja grabar audio'}</p>
    <div class="ok-voz-hex"><span class="ok-anillo"></span><span class="ok-anillo d2"></span>
      <button type="button" class="ok-voz-btn" data-voz="${grupo}" data-action="okHablar" data-p0="${grupo}" aria-label="Hablar con Oki" aria-pressed="false" ${puede ? '' : 'disabled'}>
        <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg></button></div>
    <div class="ok-voz-res" data-voz="${grupo}"></div>`;
}

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

const _dicho = new Map<string, string>();
const de = (grupo: string, clase: string) => [...document.querySelectorAll<HTMLElement>(`.${clase}[data-voz="${CSS.escape(grupo)}"]`)];

function vozEstado(grupo: string, modo: 'quieto' | 'escucha' | 'pasa', texto: string) {
  for (const e of [...de(grupo, 'ok-voz'), ...de(grupo, 'ok-hablar')]) { e.classList.toggle('escuchando', modo === 'escucha'); e.classList.toggle('pensando', modo === 'pasa'); }
  de(grupo, 'ok-voz-btn').forEach(b => b.setAttribute('aria-pressed', String(modo === 'escucha')));
  de(grupo, 'ok-voz-estado').forEach(e => { e.textContent = texto; });
  de(grupo, 'ok-hablar-sub').forEach(e => { e.textContent = modo === 'escucha' ? 'Escuchando… pulsa para acabar' : modo === 'pasa' ? 'Pasando a texto…' : 'Te escucho'; });
}

function vozResultado(grupo: string, html: string) {
  for (const r of de(grupo, 'ok-voz-res')) { r.innerHTML = html; if (html) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

// Ojo: el despachador desactiva el botón mientras dura una acción asíncrona,
// así que okHablar vuelve al momento y la escucha sigue aparte (si no, no se
// podría pulsar otra vez para parar).
async function escuchar(grupo: string) {
  vozResultado(grupo, '');
  const r = await grabarYTranscribir({
    empieza: () => vozEstado(grupo, 'escucha', 'Escuchando…'),
    pasando: () => vozEstado(grupo, 'pasa', 'Pasando a texto…'),
  });
  vozEstado(grupo, 'quieto', puedeDictar() ? 'Pulsa para hablar' : '');
  if (!r.texto) { vozResultado(grupo, `<p class="nota">${esc(r.error ?? 'No se entendió nada')}</p>`); return; }
  _dicho.set(grupo, r.texto);
  if (esPregunta(r.texto)) { ir('buscar', r.texto); return; }
  vozResultado(grupo, `<p class="ok-dicho">«${esc(r.texto)}»</p>
    <p class="nota">Suena a un encargo para el equipo. ¿Lo reparto como comanda?</p>
    <div class="acciones"><button type="button" class="btn" data-action="okComanda" data-p0="${grupo}">Repartir como comanda</button>
      <button type="button" class="btn secundario" data-action="okPreguntar" data-p0="${grupo}">No, pregúntalo</button>
      <button type="button" class="btn secundario" data-action="okDescartar" data-p0="${grupo}">Descartar</button></div>`);
}

registrarAcciones({
  okHablar(grupo: string) { if (grabando()) pararGrabacion(); else void escuchar(grupo || 'portada'); },
  async okComanda(grupo: string) {
    const texto = _dicho.get(grupo);
    if (!texto) return;
    vozResultado(grupo, '<p class="nota"><span class="hex-punto pulso" aria-hidden="true"></span> Repartiendo…</p>');
    const r = await llamarFuncion<{ tareas: unknown[] }>('comandas', { accion: 'crear', texto }, 120000);
    if (r.error || !r.data) { vozResultado(grupo, `<p class="nota">No se pudo repartir: ${esc(r.error)}</p>`); return; }
    _dicho.delete(grupo);
    toast(`Comanda repartida en ${r.data.tareas.length} tarea(s)`);
    vozResultado(grupo, `<p class="nota">Repartida en ${r.data.tareas.length} tarea(s). <a href="#/comandas">Ver comandas ›</a></p>`);
  },
  okPreguntar(grupo: string) { const t = _dicho.get(grupo); if (t) ir('buscar', t); },
  okDescartar(grupo: string) { _dicho.delete(grupo); vozResultado(grupo, ''); },
});
