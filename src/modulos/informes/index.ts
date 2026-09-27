// Informes y Telegram (fase 3): #/informes. Vincular el Telegram de cada uno
// (código de un uso), programar informes (qué, a quién, a qué hora y qué días),
// vista previa, «Enviar ahora», historial y «Pedir uno nuevo» (queda como idea
// en Proyectos). Los de dinero solo para admins (lo impone la RLS).
// Prefijo de ids: in-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { usuario, esAdmin } from '../../core/estado';
import { equipo, nombreDe } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver, ir } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast, hace, fechaHora } from '../../ui/dom';

export const TIPOS: Record<string, { nombre: string; ayuda: string; dinero?: boolean; hora: string }> = {
  repaso_matinal: { nombre: 'Repaso de la mañana', ayuda: 'Tu agenda del día, tus tickets y tareas, y tus avisos.', hora: '07:45' },
  avisos: { nombre: 'Avisos pendientes', ayuda: 'La lista del puesto de mando, agrupada.', hora: '09:00' },
  cierre_dia: { nombre: 'Cierre del día', ayuda: 'Horas fichadas por persona y trabajos de hoy sin terminar.', hora: '19:00' },
  resumen_rmm: { nombre: 'Resumen de monitorización', ayuda: 'Equipos sin conexión, alertas y discos llenos.', hora: '08:30' },
  estado_proyectos: { nombre: 'Estado de los proyectos', ayuda: 'Proyectos abiertos por fase, tareas atrasadas e hitos vencidos.', hora: '09:00' },
  cobros_vencidos: { nombre: 'Cobros vencidos', ayuda: 'Facturas de Zoho vencidas y sin cobrar.', dinero: true, hora: '09:00' },
  ventas_ayer: { nombre: 'Ventas de ayer', ayuda: 'Lo facturado y cobrado ayer, y cómo va el mes.', dinero: true, hora: '08:00' },
};
const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

interface Programado { id: string; tipo: string; usuario_id: string; hora: string; dias: number[]; activo: boolean; ultimo_envio_at: string | null }
interface Vinculo { usuario_id: string; chat_id: number | null; nombre_tg: string | null; vinculado_at: string | null }
interface EstadoBot { configurado: boolean; usuario?: string; webhook?: { puesto: boolean; pendientes: number; ultimo_error: string | null } }

let _bot: EstadoBot | null = null;
let _vista = '';

// El texto viene en el HTML de Telegram (ya escapado en la función): aquí solo
// se dejan pasar <b>, <i> y enlaces https; todo lo demás se escapa otra vez.
export function htmlTelegram(t: string): string {
  const seguro = esc(t);
  return seguro
    .replace(/&lt;(\/?)(b|i|code)&gt;/g, '<$1$2>')
    .replace(/&lt;a href=&quot;(https:\/\/[^"&<>]+?)&quot;&gt;(.*?)&lt;\/a&gt;/g, '<a href="$1" target="_blank" rel="noopener">$2</a>')
    .replace(/\n/g, '<br>');
}

function tarjetaTelegram(v: Vinculo | undefined): string {
  if (!_bot?.configurado) {
    return `<section class="tarjeta"><h3>📨 Telegram</h3><p class="aviso">El bot de Telegram todavía no está puesto. ${esAdmin()
      ? 'Los pasos están en <code>docs/FASE3.md</code>: crear el bot con @BotFather y pasarle el token a Claude.' : 'Cuando lo ponga un administrador, aquí podrás vincular tu Telegram.'}</p></section>`;
  }
  const admin = esAdmin() && _bot.webhook ? `<p class="nota">Bot @${esc(_bot.usuario)} · webhook ${_bot.webhook.puesto ? '<span class="chip bien">puesto</span>'
    : '<span class="chip mal">sin poner</span>'}${_bot.webhook.ultimo_error ? ` · último error: ${esc(_bot.webhook.ultimo_error)}` : ''}
    <button class="btn secundario" data-action="inConfigurarBot">${_bot.webhook.puesto ? 'Volver a configurar' : 'Configurar el bot'}</button></p>` : '';
  return `<section class="tarjeta"><h3>📨 Tu Telegram</h3>
    ${v?.chat_id ? `<p><span class="chip bien">Vinculado</span> ${esc(v.nombre_tg ?? '')} · desde ${esc(fechaHora(v.vinculado_at))}</p>
      <div class="acciones"><button class="btn secundario" data-action="inDesvincular">Desvincular</button></div>`
      : `<p class="nota">Vincula tu Telegram para recibir aquí los informes y pedirle cosas al bot (/avisos, /repaso…).</p>
      <div class="acciones"><button class="btn" data-action="inVincular">Vincular mi Telegram</button></div>
      <div id="in-vincular"></div>`}
    ${admin}</section>`;
}

function formulario(personas: { id: string; nombre: string }[]): string {
  const yo = usuario();
  const tipos = Object.entries(TIPOS).filter(([, t]) => esAdmin() || !t.dinero);
  return `<form class="tarjeta" data-on-submit="inCrear" data-prevent="1"><h3>Programar un informe</h3>
    <div class="in-campos">
      <label>Informe <select id="in-tipo" data-on-change="inTipo:$value">${tipos.map(([k, t]) =>
        `<option value="${k}">${esc(t.nombre)}${t.dinero ? ' (admins)' : ''}</option>`).join('')}</select></label>
      ${esAdmin() ? `<label>Para <select id="in-para">${personas.map(p => `<option value="${esc(p.id)}" ${p.id === yo?.id ? 'selected' : ''}>${esc(nombreDe(p.id) || p.nombre)}</option>`).join('')}</select></label>` : ''}
      <label>Hora (Canarias) <input id="in-hora" type="time" value="${TIPOS[tipos[0][0]].hora}" required></label>
    </div>
    <fieldset class="in-dias"><legend>Días</legend>${DIAS.map((d, i) =>
      `<label class="check"><input type="checkbox" name="in-dia" value="${i + 1}" ${i < 5 ? 'checked' : ''}> ${d}</label>`).join('')}</fieldset>
    <p id="in-ayuda" class="nota">${esc(TIPOS[tipos[0][0]].ayuda)}</p>
    <div class="acciones"><button class="btn" type="submit">Programar</button>
      <button class="btn secundario" type="button" data-action="inVistaPrevia">Vista previa</button>
      <button class="btn secundario" type="button" data-action="inEnviarTipo">Mandármelo ahora</button></div>
    <div id="in-vista" class="in-vista" ${_vista ? '' : 'hidden'}>${_vista}</div>
  </form>`;
}

function tablaProgramados(lista: Programado[]): string {
  if (!lista.length) return '<p class="vacio">Todavía no hay informes programados.</p>';
  return `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Informe</th>${esAdmin() ? '<th>Para</th>' : ''}<th>Cuándo</th><th>Último envío</th><th></th></tr></thead>
    <tbody>${lista.map(p => `<tr class="${p.activo ? '' : 'in-pausado'}">
      <td><strong>${esc(TIPOS[p.tipo]?.nombre ?? p.tipo)}</strong>${p.activo ? '' : ' <span class="chip">En pausa</span>'}</td>
      ${esAdmin() ? `<td>${esc(nombreDe(p.usuario_id))}</td>` : ''}
      <td>${esc(p.hora.slice(0, 5))} · ${p.dias.length === 7 ? 'todos los días' : p.dias.map(d => DIAS[d - 1]).join(' ')}</td>
      <td>${p.ultimo_envio_at ? esc(hace(p.ultimo_envio_at)) : '—'}</td>
      <td class="acciones">
        <button class="btn secundario" data-action="inEnviarAhora" data-p0="${esc(p.id)}">Enviar ahora</button>
        <button class="btn secundario" data-action="inPausar" data-p0="${esc(p.id)}" data-p1="${p.activo ? '0' : '1'}">${p.activo ? 'Pausar' : 'Reanudar'}</button>
        <button class="btn peligro" data-action="inBorrar" data-p0="${esc(p.id)}">Borrar</button>
      </td></tr>`).join('')}</tbody></table></div>`;
}

async function historial(): Promise<string> {
  const { data } = await API.get<any[]>('informes_envios', { select: 'created_at,tipo,usuario_id,origen,ok,error', order: 'id.desc', limit: '20' });
  if (!data?.length) return '<p class="vacio">Nada enviado todavía.</p>';
  const origen: Record<string, string> = { programado: 'Programado', manual: 'A mano', bot: 'Pedido al bot' };
  return `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Cuándo</th><th>Informe</th>${esAdmin() ? '<th>Para</th>' : ''}<th>Cómo</th><th>Resultado</th></tr></thead>
    <tbody>${data.map(e => `<tr><td>${esc(fechaHora(e.created_at))}</td><td>${esc(TIPOS[e.tipo]?.nombre ?? e.tipo)}</td>
      ${esAdmin() ? `<td>${esc(nombreDe(e.usuario_id))}</td>` : ''}<td>${esc(origen[e.origen] ?? e.origen)}</td>
      <td>${e.ok ? '<span class="chip bien">Enviado</span>' : `<span class="chip mal">Error</span> <small>${esc(e.error ?? '')}</small>`}</td></tr>`).join('')}</tbody></table></div>`;
}

async function pintar(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const yo = usuario();
  const [personas, prog, vinc, bot] = await Promise.all([
    equipo(),
    API.get<Programado[]>('informes_programados', { select: 'id,tipo,usuario_id,hora,dias,activo,ultimo_envio_at', order: 'hora' }),
    API.get<Vinculo[]>('telegram_vinculos', { select: 'usuario_id,chat_id,nombre_tg,vinculado_at', usuario_id: `eq.${yo?.id}` }),
    _bot ? Promise.resolve({ data: _bot, error: null }) : llamarFuncion<EstadoBot>('telegram-bot', { accion: 'estado' }),
  ]);
  _bot = bot.data ?? { configurado: false };
  if (prog.error) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los informes: ${esc(prog.error.message)}</p>`; return; }
  el.innerHTML = `<div class="in-rejilla">${tarjetaTelegram(vinc.data?.[0])}${formulario(personas)}</div>
    <h2>Programados</h2>${tablaProgramados(prog.data ?? [])}
    <h2>Pedir un informe nuevo</h2>
    <form class="tarjeta" data-on-submit="inPedir" data-prevent="1">
      <label for="in-pedir">¿Qué te gustaría recibir y cuándo? Queda como idea en Proyectos para que se construya.</label>
      <textarea id="in-pedir" rows="2" maxlength="1000" placeholder="p. ej. Cada lunes, los clientes con mantenimiento que no han tenido visita en 3 meses"></textarea>
      <div class="acciones"><button class="btn secundario" type="submit">Pedirlo</button></div>
    </form>
    <h2>Últimos envíos</h2>${await historial()}`;
}

function tipoElegido(): string { return (document.getElementById('in-tipo') as HTMLSelectElement | null)?.value ?? 'avisos'; }

registrarAcciones({
  inTipo(t: string) {
    const a = document.getElementById('in-ayuda'); if (a) a.textContent = TIPOS[t]?.ayuda ?? '';
    const h = document.getElementById('in-hora') as HTMLInputElement | null; if (h && TIPOS[t]) h.value = TIPOS[t].hora;
  },
  async inCrear() {
    const dias = [...document.querySelectorAll<HTMLInputElement>('input[name="in-dia"]:checked')].map(c => Number(c.value));
    if (!dias.length) { toast('Elige al menos un día', 'error'); return; }
    const para = (document.getElementById('in-para') as HTMLSelectElement | null)?.value ?? usuario()?.id;
    const hora = (document.getElementById('in-hora') as HTMLInputElement).value;
    const r = await API.post('informes_programados', { tipo: tipoElegido(), usuario_id: para, hora, dias });
    if (r.error) { toast(`No se pudo programar: ${r.error.message}`, 'error'); return; }
    toast('Informe programado');
    _vista = '';
    resolver();
  },
  async inVistaPrevia() {
    const caja = document.getElementById('in-vista');
    if (!caja) return;
    caja.hidden = false; caja.innerHTML = '<p class="cargando">Preparando…</p>';
    const r = await llamarFuncion<{ texto: string }>('informes-enviar', { accion: 'vista_previa', tipo: tipoElegido() });
    _vista = r.error ? `<p class="aviso mal">${esc(r.error)}</p>` : htmlTelegram(r.data?.texto ?? '');
    caja.innerHTML = _vista;
  },
  async inEnviarTipo() {
    const r = await llamarFuncion<{ ok: boolean; error: string | null }>('informes-enviar', { accion: 'enviar_tipo', tipo: tipoElegido() });
    const err = r.error ?? r.data?.error;
    toast(err ? `No se envió: ${err}` : 'Enviado a tu Telegram', err ? 'error' : 'info');
    if (!r.error) resolver();
  },
  async inEnviarAhora(id: string) {
    const r = await llamarFuncion<{ ok: boolean; error: string | null }>('informes-enviar', { accion: 'enviar_ahora', id });
    const err = r.error ?? r.data?.error;
    toast(err ? `No se envió: ${err}` : 'Enviado', err ? 'error' : 'info');
    resolver();
  },
  async inPausar(id: string, activo: string) {
    const r = await API.patch('informes_programados', { id: `eq.${id}` }, { activo: activo === '1' });
    if (r.error) toast(`No se pudo cambiar: ${r.error.message}`, 'error');
    resolver();
  },
  async inBorrar(id: string) {
    if (!confirm('¿Borrar este informe programado?')) return;
    const r = await API.delete('informes_programados', { id: `eq.${id}` });
    if (r.error) toast(`No se pudo borrar: ${r.error.message}`, 'error');
    resolver();
  },
  async inVincular() {
    const caja = document.getElementById('in-vincular');
    const r = await API.rpc<string>('telegram_codigo');
    if (r.error || !r.data || !caja) { toast(`No se pudo: ${r.error?.message ?? 'sin código'}`, 'error'); return; }
    const url = `https://t.me/${_bot?.usuario ?? ''}?start=${r.data}`;
    caja.innerHTML = `<p>Abre este enlace en el móvil (o donde tengas Telegram) y pulsa <strong>Iniciar</strong>:</p>
      <p><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Abrir @${esc(_bot?.usuario ?? 'bot')} en Telegram</a></p>
      <p class="nota">Vale 15 minutos. Si no se abre, busca @${esc(_bot?.usuario ?? '')} en Telegram y escríbele: <code>/start ${esc(r.data)}</code>.
      Después, <a href="#/informes" data-action="inRecargar">recarga esta pantalla</a>.</p>`;
  },
  inRecargar() { resolver(); },
  async inDesvincular() {
    if (!confirm('¿Desvincular tu Telegram? Dejarán de llegarte los informes.')) return;
    const r = await API.rpc('telegram_desvincular');
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error');
    resolver();
  },
  async inConfigurarBot() {
    const r = await llamarFuncion('telegram-bot', { accion: 'configurar' });
    toast(r.error ? `No se pudo configurar: ${r.error}` : 'Bot configurado: webhook y comandos puestos', r.error ? 'error' : 'info');
    _bot = null;
    resolver();
  },
  async inPedir() {
    const t = (document.getElementById('in-pedir') as HTMLTextAreaElement).value.trim();
    if (!t) return;
    const r = await API.post<any[]>('proyectos', { titulo: `Informe nuevo: ${t.slice(0, 120)}`, descripcion: t, tipo: 'interno', estado: 'idea', responsable_id: usuario()?.id ?? null });
    if (r.error) { toast(`No se pudo apuntar: ${r.error.message}`, 'error'); return; }
    toast(`Apuntado como idea #${r.data?.[0]?.numero}`);
    ir('proyectos', String(r.data?.[0]?.numero ?? ''));
  },
});

async function contador(): Promise<Contador | null> {
  const n = await API.contar('informes_programados', { activo: 'eq.true' });
  return n == null ? null : { valor: n, subtitulo: 'informes programados', tono: 'neutro' };
}

export const moduloInformes: Modulo = {
  id: 'informes',
  titulo: 'Informes y Telegram',
  grupo: 'General',
  icono: '📨',
  explicacion: 'Recibe por Telegram el repaso de la mañana, los avisos, el cierre del día, el estado de los equipos o de los proyectos (y, si eres administrador, cobros y ventas) a la hora que quieras. Primero vincula tu Telegram; luego programa los informes o pídeselos al bot cuando quieras (/avisos, /repaso…).',
  pintar,
  contador,
};
