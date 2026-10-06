// Personas (fase 10): #/personas (registro de jornada, RD-ley 8/2019),
// #/personas/ausencias, #/personas/gastos (tickets leídos por Claude y, desde la
// paridad del bloque 7, los gastos y cobros de la app: movimientos.ts) y
// #/personas/cierre (el mes con la gestoría, solo admins). La jornada se
// calcula sobre los fichajes de la app (hub.jornada); las correcciones van con
// motivo a hub.jornada_ajustes. Prefijo de ids: pe-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { esAdmin, usuario } from '../../core/estado';
import { equipo, nombreDe } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast, hace, fecha, pl } from '../../ui/dom';
import { ico, type IconoLinea } from '../../shell/linea';
import { eur } from '../ventas/datos';
import { seccionMovimientos, vistaMovimiento } from './movimientos';

// '2026-09' → «Septiembre de 2026».
const nombreMes = (m: string) => {
  const [a, n] = m.split('-').map(Number);
  const t = new Date(a, (n || 1) - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return Number.isNaN(a) ? m : t.charAt(0).toUpperCase() + t.slice(1);
};

interface Dia { usuario_id: string; nombre: string; fecha: string; entrada: string | null; salida: string | null; trabajado_min: number | null;
  pausas_min: number | null; sesiones: number; ajustado: boolean; motivo_ajuste: string | null; ausencia: string | null }
interface Ausencia { id: string; created_at: string; usuario_id: string; tipo: string; desde: string; hasta: string; dias: number; estado: string; nota: string | null; respuesta: string | null }
interface Gasto { id: string; created_at: string; subido_por: string | null; archivo_path: string | null; fecha: string | null; proveedor: string | null; nif: string | null;
  concepto: string | null; base: number | null; impuesto_pct: number | null; impuesto: number | null; total: number | null; categoria: string | null; forma_pago: string | null;
  estado: string; error: string | null; notas: string | null; leido_por_claude: boolean }

const PESTANAS: [string, string, boolean][] = [['', 'Jornada', false], ['ausencias', 'Ausencias', false], ['gastos', 'Gastos', false], ['cierre', 'Cierre del mes', true]];
const TIPOS_AUS: Record<string, string> = { vacaciones: 'Vacaciones', asuntos_propios: 'Asuntos propios', baja: 'Baja', permiso: 'Permiso', otro: 'Otro' };
const ICONO_AUS: Record<string, IconoLinea> = { vacaciones: 'vacaciones', asuntos_propios: 'chincheta', baja: 'salud', permiso: 'documento' };
/** Tipo de ausencia para HTML: icono (si lo tiene) y texto escapado. */
const ausHtml = (k: string) => `${ICONO_AUS[k] ? `${ico(ICONO_AUS[k])} ` : ''}${esc(TIPOS_AUS[k] ?? k)}`;
const ESTADO_AUS: Record<string, string> = { solicitada: 'aviso', aprobada: 'bien', rechazada: 'mal', anulada: '' };
const CATEGORIAS = ['Material', 'Combustible', 'Dietas', 'Aparcamiento y peajes', 'Transporte', 'Software y suscripciones', 'Teléfono e internet', 'Oficina', 'Herramientas', 'Otros'];
const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const mesActual = () => new Date().toLocaleDateString('sv-SE').slice(0, 7);
const limites = (mes: string) => { const [a, m] = mes.split('-').map(Number); return { desde: `${mes}-01`, hasta: new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) }; };
const hm = (min: number | null | undefined) => min == null ? '—' : `${Math.floor(min / 60)}:${String(Math.abs(min % 60)).padStart(2, '0')}`;
const hora = (v: string | null) => v ? new Date(v).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Atlantic/Canary' }) : '—';
const diaSemana = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });

let _dias: Dia[] = [];
let _gasto: Gasto | null = null;

const pestanas = (activa: string) => `<nav class="segmentado al-pestanas" aria-label="Personas">${PESTANAS.filter(([, , adm]) => !adm || esAdmin()).map(([k, t]) =>
  `<a class="${k === activa ? 'activo' : ''}" href="#/personas${k ? '/' + k : ''}" ${k === activa ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;

function csv(filas: (string | number | null)[][]): string {
  return filas.map(f => f.map(v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n');
}
function descargar(nombre: string, texto: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Jornada ────────────────────────────────────────────────────────────────
async function vistaJornada(): Promise<string> {
  const mes = leer('hub_pe_mes', mesActual());
  const personas = await equipo();
  const quien = esAdmin() ? leer('hub_pe_persona', usuario()?.id ?? '') : usuario()?.id ?? '';
  const { desde, hasta } = limites(mes);
  const [r, conf] = await Promise.all([
    API.rpc<Dia[]>('jornada', { p_desde: desde, p_hasta: hasta, p_usuario: quien || null }),
    API.get<any[]>('jornada_cierres', { select: '*', mes: `eq.${desde}`, ...(quien ? { usuario_id: `eq.${quien}` } : {}) }),
  ]);
  if (r.error) return `<p class="aviso mal">${esc(r.error.message)}</p>`;
  _dias = r.data ?? [];
  const total = _dias.reduce((a, d) => a + (d.trabajado_min ?? 0), 0);
  const trabajados = _dias.filter(d => (d.trabajado_min ?? 0) > 0).length;
  const conformado = (conf.data ?? [])[0];
  const pasado = mes < mesActual();
  return `<p class="nota">Registro diario de jornada (RD-ley 8/2019): sale de los fichajes de la app (traslado, inicio y fin de cada visita). Si falta algo,
      lo corrige un administrador con su motivo; el fichaje original no se toca. Se guarda cuatro años.</p>
    <div class="acciones pr-barra"><label>Mes <input type="month" id="pe-mes" value="${esc(mes)}" data-on-change="peMes:$value"></label>
      ${esAdmin() ? `<label>Persona <select id="pe-persona" data-on-change="pePersona:$value">${personas.map(p => `<option value="${p.id}" ${p.id === quien ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>` : ''}
      <button class="btn secundario" data-action="peCsv">Descargar (CSV)</button><button class="btn secundario" data-action="peImprimir">Imprimir</button></div>
    <div class="di-cifras"><article class="tarjeta di-cifra"><h3>Horas del mes</h3><p class="di-valor">${hm(total)}</p></article>
      <article class="tarjeta di-cifra"><h3>Días con trabajo</h3><p class="di-valor">${trabajados}</p></article>
      <article class="tarjeta di-cifra"><h3>Conformidad</h3><p class="di-valor">${conformado ? '✓' : '—'}</p><p class="nota">${conformado ? `dada ${esc(hace(conformado.confirmado_at))}`
        : pasado && quien === usuario()?.id ? '<button class="btn" data-action="peConformidad">Doy mi conformidad</button>' : 'la da cada persona al acabar el mes'}</p></article></div>
    <div class="tarjeta mo-scroll pe-imprimible"><h3 class="solo-imprimir">Registro de jornada · ${esc(nombreDe(quien))} · ${esc(mes)}</h3>
      <table class="tabla pe-jornada"><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th>Trabajado</th><th>Pausas</th><th>Observaciones</th>${esAdmin() ? '<th class="no-imprimir"></th>' : ''}</tr></thead><tbody>
      ${_dias.map(d => `<tr class="${d.ausencia ? 'pe-ausencia' : ''}"><td>${esc(diaSemana(d.fecha))}</td><td>${hora(d.entrada)}</td><td>${hora(d.salida)}</td>
        <td>${hm(d.trabajado_min)}</td><td>${hm(d.pausas_min)}</td>
        <td>${(d.trabajado_min ?? 0) > 720 && !d.ajustado ? '<span class="chip mal">más de 12 h: ¿se quedó un fichaje abierto?</span> ' : ''}${d.ausencia ? ausHtml(d.ausencia) : ''}${d.ajustado ? ` <span class="chip aviso" title="${esc(d.motivo_ajuste ?? '')}">corregido: ${esc(d.motivo_ajuste ?? '')}</span>` : ''}${d.sesiones ? ` <small class="nota">${pl(d.sesiones, 'fichaje', 'fichajes')}</small>` : ''}</td>
        ${esAdmin() ? `<td class="no-imprimir"><button class="btn secundario" data-action="peCorregir" data-p0="${esc(d.fecha)}">Corregir</button></td>` : ''}</tr>`).join('')
        || `<tr><td colspan="7" class="vacio">Sin fichajes este mes.</td></tr>`}
      </tbody><tfoot><tr><th colspan="3">Total</th><th>${hm(total)}</th><th colspan="3"></th></tr></tfoot></table></div>
    ${esAdmin() ? `<form class="tarjeta" id="pe-corregir" data-on-submit="peGuardarAjuste" data-prevent="1" hidden><h3>Corregir el día <span id="pe-cor-dia"></span></h3>
      <div class="in-campos"><label>Entrada <input type="time" id="pe-cor-entrada" required></label><label>Salida <input type="time" id="pe-cor-salida" required></label>
        <label>Pausas (min) <input type="number" id="pe-cor-pausa" min="0" value="0"></label></div>
      <label>Motivo (queda en el registro) <input id="pe-cor-motivo" required minlength="5" placeholder="p. ej. No fichó la primera visita"></label>
      <input type="hidden" id="pe-cor-fecha"><div class="acciones"><button class="btn" type="submit">Guardar corrección</button></div></form>` : ''}`;
}

// ── Ausencias ──────────────────────────────────────────────────────────────
async function vistaAusencias(): Promise<string> {
  const anio = new Date().getFullYear();
  const [aus, personas, cfg] = await Promise.all([
    API.get<Ausencia[]>('ausencias', { select: '*', hasta: `gte.${anio}-01-01`, order: 'desde.desc' }), equipo(),
    API.single<{ valor: number }>('config', { select: 'valor', clave: 'eq.vacaciones_dias' }),
  ]);
  const yo = usuario()?.id;
  const todas = aus.data ?? [];
  const usadas = todas.filter(a => a.usuario_id === yo && a.tipo === 'vacaciones' && a.estado === 'aprobada' && a.desde >= `${anio}-01-01`).reduce((s, a) => s + (a.dias ?? 0), 0);
  const pedidas = todas.filter(a => a.usuario_id === yo && a.tipo === 'vacaciones' && a.estado === 'solicitada').reduce((s, a) => s + (a.dias ?? 0), 0);
  const total = Number(cfg.data?.valor ?? 22);
  return `<div class="di-cifras"><article class="tarjeta di-cifra"><h3>Tus vacaciones ${anio}</h3><p class="di-valor">${total - usadas}</p><p class="nota">días que te quedan de ${total}${pedidas ? ` · ${pedidas} pedidos` : ''}</p></article></div>
    <form class="tarjeta" data-on-submit="pePedir" data-prevent="1"><h3>${esAdmin() ? 'Apuntar una ausencia' : 'Pedir días'}</h3><div class="in-campos">
      ${esAdmin() ? `<label>Persona <select id="pe-aus-persona">${personas.map(p => `<option value="${p.id}" ${p.id === yo ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>` : ''}
      <label>Tipo <select id="pe-aus-tipo">${Object.entries(TIPOS_AUS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label>Desde <input type="date" id="pe-aus-desde" required></label><label>Hasta <input type="date" id="pe-aus-hasta" required></label></div>
      <label>Nota <input id="pe-aus-nota" placeholder="Opcional"></label><div class="acciones"><button class="btn" type="submit">${esAdmin() ? 'Apuntar' : 'Pedir'}</button></div></form>
    <div class="tarjeta mo-scroll"><h3>Este año</h3>${todas.length ? `<table class="tabla"><thead><tr><th>Quién</th><th>Qué</th><th>Fechas</th><th>Días</th><th>Estado</th><th></th></tr></thead><tbody>
      ${todas.map(a => `<tr><td>${esc(nombreDe(a.usuario_id))}</td><td>${ausHtml(a.tipo)}${a.nota ? `<br><small class="nota">${esc(a.nota)}</small>` : ''}</td>
        <td>${esc(a.desde)} → ${esc(a.hasta)}</td><td>${a.dias ?? ''}</td><td><span class="chip ${ESTADO_AUS[a.estado] ?? ''}">${esc(a.estado)}</span>${a.respuesta ? `<br><small class="nota">${esc(a.respuesta)}</small>` : ''}</td>
        <td><div class="acciones">${esAdmin() && a.estado === 'solicitada' ? `<button class="btn" data-action="peDecidir" data-p0="${a.id}" data-p1="aprobada">Aprobar</button><button class="btn secundario" data-action="peDecidir" data-p0="${a.id}" data-p1="rechazada">Rechazar</button>` : ''}
          ${a.usuario_id === yo && a.estado === 'solicitada' ? `<button class="btn secundario" data-action="peAnular" data-p0="${a.id}">Anular</button>` : ''}</div></td></tr>`).join('')}
      </tbody></table>` : '<p class="vacio">Ninguna todavía.</p>'}</div>`;
}

// ── Gastos ─────────────────────────────────────────────────────────────────
function formGasto(g: Gasto): string {
  const c = (k: keyof Gasto, t: string, tipo = 'text', extra = '') => `<label>${t} <input name="${k}" type="${tipo}" ${extra} value="${esc(g[k] ?? '')}"></label>`;
  return `<form class="tarjeta" id="pe-gasto" data-on-submit="peGuardarGasto" data-prevent="1"><div class="tarjeta-cab"><h3>Revisar gasto</h3>
      ${g.archivo_path ? `<button type="button" class="btn secundario" data-action="peVerArchivo" data-p0="${g.id}">Ver el ticket</button>` : ''}</div>
    ${g.error ? `<p class="aviso">${esc(g.error)}</p>` : g.leido_por_claude ? '<p class="nota">Leído por Claude: comprueba que está bien antes de confirmarlo.</p>' : ''}
    <div class="in-campos">${c('fecha', 'Fecha', 'date')}${c('proveedor', 'Proveedor')}${c('nif', 'NIF')}${c('base', 'Base (€)', 'number', 'step="0.01"')}
      ${c('impuesto_pct', 'IGIC/IVA (%)', 'number', 'step="0.01"')}${c('impuesto', 'Impuesto (€)', 'number', 'step="0.01"')}${c('total', 'Total (€)', 'number', 'step="0.01" required')}
      <label>Categoría <select name="categoria">${CATEGORIAS.map(x => `<option ${x === g.categoria ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      ${c('forma_pago', 'Forma de pago')}</div>
    ${c('concepto', 'Concepto')}<label>Notas <input name="notas" value="${esc(g.notas ?? '')}"></label>
    <div class="acciones"><button class="btn" type="submit" name="ok" value="1">${esAdmin() ? 'Confirmar' : 'Guardar'}</button>
      <button class="btn secundario" type="button" data-action="peCerrarGasto">Cerrar</button></div></form>`;
}

async function vistaGastos(): Promise<string> {
  const mes = leer('hub_pe_mes', mesActual());
  const { desde, hasta } = limites(mes);
  const { data } = await API.get<Gasto[]>('tickets_gasto', { select: '*', or: `(fecha.gte.${desde},fecha.is.null,estado.in.(leyendo,revisar,error))`, order: 'created_at.desc', limit: '300' });
  const lista = (data ?? []).filter(g => !g.fecha || (g.fecha >= desde && g.fecha <= hasta) || g.estado !== 'ok');
  const movimientos = await seccionMovimientos(desde, hasta);
  const total = lista.filter(g => g.estado === 'ok').reduce((s, g) => s + Number(g.total ?? 0), 0);
  return `<form class="tarjeta pe-subir" data-on-submit="peSubir" data-prevent="1"><h3>Subir un ticket de gasto</h3>
      <p class="nota">Una foto del ticket o la factura en PDF: Claude lee la fecha, el proveedor, el NIF, la base, el IGIC y el total. Lo revisas y queda para la gestoría.</p>
      <label>Foto o PDF del gasto <input type="file" id="pe-archivo" accept="image/*,application/pdf" required></label>
      <div class="acciones"><button class="btn" type="submit" id="pe-subir-btn">Subir y leer</button><span class="nota" id="pe-subir-estado"></span></div></form>
    <div id="pe-gasto-caja">${_gasto ? formGasto(_gasto) : ''}</div>
    <div class="acciones pr-barra"><label>Mes <input type="month" value="${esc(mes)}" data-on-change="peMes:$value"></label><span class="nota">Confirmados: ${eur(total, 2)}</span></div>
    <div class="tarjeta mo-scroll">${lista.length ? `<table class="tabla"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Concepto</th><th>Total</th><th>Estado</th>${esAdmin() ? '<th>Quién</th>' : ''}</tr></thead><tbody>
      ${lista.map(g => `<tr class="fila-clic" data-action="peAbrirGasto" data-p0="${g.id}"><td>${esc(fecha(g.fecha) || '—')}</td><td>${esc(g.proveedor ?? '')}</td><td>${esc(g.concepto ?? g.categoria ?? '')}</td>
        <td>${g.total != null ? eur(g.total, 2) : '—'}</td><td><span class="chip ${g.estado === 'ok' ? 'bien' : g.estado === 'error' ? 'mal' : 'aviso'}">${esc({ ok: 'confirmado', revisar: 'por revisar', leyendo: 'leyendo…', error: 'revisar a mano' }[g.estado] ?? g.estado)}</span></td>
        ${esAdmin() ? `<td>${esc(nombreDe(g.subido_por))}</td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="vacio">Sin gastos este mes.</p>'}</div>
    ${movimientos}
    <p class="nota">La gestoría ve los dos: los tickets leídos y los gastos y cobros de los técnicos.</p>`;
}

// ── Cierre del mes ─────────────────────────────────────────────────────────
async function vistaCierre(): Promise<string> {
  if (!esAdmin()) return '<p class="aviso">Solo un administrador cierra el mes.</p>';
  const mes = leer('hub_pe_mes_cierre', (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString('sv-SE').slice(0, 7); })());
  const { desde } = limites(mes);
  const [c, acc, conf, personas] = await Promise.all([API.single<any>('cierres_mes', { select: '*', mes: `eq.${desde}` }),
    API.get<any[]>('portal_accesos', { select: 'email,nombre,activo,ultima_entrada_at', tipo: 'eq.gestoria' }),
    API.get<any[]>('jornada_cierres', { select: 'usuario_id,confirmado_at', mes: `eq.${desde}` }), equipo()]);
  const est = c.data?.estado ?? 'abierto';
  return `<div class="acciones pr-barra"><label>Mes <input type="month" value="${esc(mes)}" data-on-change="peMesCierre:$value"></label></div>
    <section class="tarjeta"><h3>${esc(nombreMes(mes))} <span class="chip ${est === 'cerrado' ? 'bien' : est === 'revisado' ? 'aviso' : ''}">${esc(est)}</span></h3>
      ${c.data?.revisado_at ? `<p>La gestoría (${esc(c.data.revisado_por ?? '')}) lo revisó ${esc(hace(c.data.revisado_at))}${c.data.nota_gestoria ? `: «${esc(c.data.nota_gestoria)}»` : '.'}</p>` : '<p class="nota">La gestoría aún no lo ha revisado.</p>'}
      <h4>Conformidad con la jornada</h4><ul>${personas.map(p => { const x = (conf.data ?? []).find(y => y.usuario_id === p.id); return `<li>${esc(p.nombre)}: ${x ? `✓ ${esc(hace(x.confirmado_at))}` : '<span class="nota">pendiente</span>'}</li>`; }).join('')}</ul>
      ${est !== 'cerrado' ? `<form data-on-submit="peCerrarMes" data-prevent="1"><label>Nota <input id="pe-cierre-nota" value="${esc(c.data?.nota ?? '')}"></label>
        <div class="acciones"><button class="btn" type="submit">Cerrar el mes</button></div></form>` : `<p>Cerrado ${esc(hace(c.data.cerrado_at))}.</p>`}</section>
    <section class="tarjeta"><h3>Acceso de la gestoría</h3>${(acc.data ?? []).length ? `<ul>${(acc.data ?? []).map(a => `<li>${esc(a.nombre ?? '')} &lt;${esc(a.email)}&gt; ${a.activo ? `· última entrada ${esc(a.ultima_entrada_at ? hace(a.ultima_entrada_at) : 'nunca')}` : '· <span class="chip">revocado</span>'}</li>`).join('')}</ul>` : '<p class="nota">Nadie todavía.</p>'}
      <p class="nota">Se da y se quita en <a href="#/portal">Portal de clientes</a> (tipo «Gestoría»). Todo lo que consulta queda en la traza.</p></section>`;
}

async function pintar(el: HTMLElement, params: string[]) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [a, b, c, d] = params;
  const cuerpo = a === 'ausencias' ? await vistaAusencias()
    : a === 'gastos' && (b === 'gasto' || b === 'cobro') ? await vistaMovimiento(b, '', c === 't' ? d ?? '' : '')
    : a === 'gastos' && b === 'mov' && c ? await vistaMovimiento('mov', c)
    : a === 'gastos' ? await vistaGastos() : a === 'cierre' ? await vistaCierre() : await vistaJornada();
  el.innerHTML = pestanas(a && PESTANAS.some(([k]) => k === a) ? a : '') + cuerpo;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const aBase64 = (f: Blob) => new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = mal; r.readAsDataURL(f); });
// «09:30» del día `fecha` en hora de Canarias → ISO (Canarias va a UTC+0 en invierno y +1 en verano).
function isoCanarias(fecha: string, hhmm: string): string {
  const prueba = new Date(`${fecha}T${hhmm}:00Z`);
  const enCanarias = new Date(prueba.toLocaleString('en-US', { timeZone: 'Atlantic/Canary' }));
  const enUtc = new Date(prueba.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(prueba.getTime() - (enCanarias.getTime() - enUtc.getTime())).toISOString();
}

registrarAcciones({
  peMes(v: string) { if (v) { guardar('hub_pe_mes', v); resolver(); } },
  peMesCierre(v: string) { if (v) { guardar('hub_pe_mes_cierre', v); resolver(); } },
  pePersona(v: string) { guardar('hub_pe_persona', v); resolver(); },
  peCsv() {
    const quien = _dias[0]?.nombre ?? nombreDe(usuario()?.id);
    descargar(`jornada-${leer('hub_pe_mes', mesActual())}-${quien.replace(/\W+/g, '_')}.csv`, csv([['Persona', 'Día', 'Entrada', 'Salida', 'Trabajado', 'Pausas', 'Observaciones'],
      ..._dias.map(d => [d.nombre, d.fecha, hora(d.entrada), hora(d.salida), hm(d.trabajado_min), hm(d.pausas_min),
        [d.ausencia ? TIPOS_AUS[d.ausencia] ?? d.ausencia : '', d.ajustado ? `corregido: ${d.motivo_ajuste}` : ''].filter(Boolean).join(' · ')])]));
  },
  peImprimir() { window.print(); },
  peCorregir(fecha: string) {
    const f = document.getElementById('pe-corregir') as HTMLFormElement | null;
    if (!f) return;
    const d = _dias.find(x => x.fecha === fecha);
    f.hidden = false;
    (document.getElementById('pe-cor-fecha') as HTMLInputElement).value = fecha;
    document.getElementById('pe-cor-dia')!.textContent = diaSemana(fecha);
    (document.getElementById('pe-cor-entrada') as HTMLInputElement).value = d?.entrada ? hora(d.entrada) : '09:00';
    (document.getElementById('pe-cor-salida') as HTMLInputElement).value = d?.salida ? hora(d.salida) : '14:00';
    (document.getElementById('pe-cor-pausa') as HTMLInputElement).value = String(d?.ajustado ? d.pausas_min ?? 0 : 0);
    (document.getElementById('pe-cor-motivo') as HTMLInputElement).value = d?.motivo_ajuste ?? '';
    f.scrollIntoView({ block: 'center' });
  },
  async peGuardarAjuste() {
    const fecha = val('pe-cor-fecha'), quien = val('pe-persona') || usuario()?.id;
    const r = await API.upsert('jornada_ajustes', 'usuario_id,fecha', { usuario_id: quien, fecha, entrada: isoCanarias(fecha, val('pe-cor-entrada')), salida: isoCanarias(fecha, val('pe-cor-salida')),
      pausa_min: Number(val('pe-cor-pausa')) || 0, motivo: val('pe-cor-motivo') });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast('Corrección guardada'); resolver(); }
  },
  async peConformidad() {
    const { desde } = limites(leer('hub_pe_mes', mesActual()));
    const r = await API.post('jornada_cierres', { usuario_id: usuario()?.id, mes: desde });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast('Conformidad dada'); resolver(); }
  },
  async pePedir() {
    const d = { usuario_id: esAdmin() ? val('pe-aus-persona') : usuario()?.id, tipo: val('pe-aus-tipo'), desde: val('pe-aus-desde'), hasta: val('pe-aus-hasta'), nota: val('pe-aus-nota') || null,
      estado: esAdmin() ? 'aprobada' : 'solicitada' };
    if (d.hasta < d.desde) { toast('La fecha final va después de la inicial', 'error'); return; }
    const r = await API.post('ausencias', d);
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast(esAdmin() ? 'Apuntada' : 'Pedida: te avisará un administrador'); resolver(); }
  },
  async peDecidir(id: string, estado: string) {
    const respuesta = estado === 'rechazada' ? prompt('¿Por qué? (lo verá la persona)') ?? '' : '';
    const r = await API.patch('ausencias', { id: `eq.${id}` }, { estado, respuesta: respuesta || null });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async peAnular(id: string) {
    const r = await API.patch('ausencias', { id: `eq.${id}` }, { estado: 'anulada' });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async peSubir() {
    const f = (document.getElementById('pe-archivo') as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { toast('El fichero pasa de 12 MB', 'error'); return; }
    const est = document.getElementById('pe-subir-estado'), btn = document.getElementById('pe-subir-btn') as HTMLButtonElement;
    btn.disabled = true; if (est) est.textContent = 'Subiendo y leyendo… (unos segundos)';
    const r = await llamarFuncion<Gasto>('gastos-ocr', { accion: 'subir', archivo: await aBase64(f), tipo: f.type || 'image/jpeg', nombre: f.name }, 120000);
    btn.disabled = false; if (est) est.textContent = '';
    if (r.error || !r.data) { toast(`No se pudo: ${r.error}`, 'error'); return; }
    _gasto = r.data;
    resolver();
  },
  async peAbrirGasto(id: string) {
    const { data } = await API.single<Gasto>('tickets_gasto', { select: '*', id: `eq.${id}` });
    _gasto = data ?? null;
    const c = document.getElementById('pe-gasto-caja');
    if (c && _gasto) { c.innerHTML = formGasto(_gasto); c.scrollIntoView({ block: 'start' }); }
  },
  peCerrarGasto() { _gasto = null; const c = document.getElementById('pe-gasto-caja'); if (c) c.innerHTML = ''; },
  async peVerArchivo(id: string) {
    const r = await llamarFuncion<{ url: string }>('gastos-ocr', { accion: 'url', id });
    if (r.error || !r.data) toast(`No se pudo: ${r.error}`, 'error'); else window.open(r.data.url, '_blank', 'noopener');
  },
  async peGuardarGasto() {
    if (!_gasto) return;
    const fd = new FormData(document.getElementById('pe-gasto') as HTMLFormElement);
    const s = (k: string) => { const v = String(fd.get(k) ?? '').trim(); return v === '' ? null : v; };
    const n = (k: string) => s(k) == null ? null : Number(s(k));
    const d: Record<string, unknown> = { fecha: s('fecha'), proveedor: s('proveedor'), nif: s('nif'), concepto: s('concepto'), base: n('base'), impuesto_pct: n('impuesto_pct'),
      impuesto: n('impuesto'), total: n('total'), categoria: s('categoria'), forma_pago: s('forma_pago'), notas: s('notas'), estado: esAdmin() ? 'ok' : 'revisar', error: null };
    if (!d.fecha || d.total == null) { toast('Falta la fecha o el total', 'error'); return; }
    const r = await API.patch('tickets_gasto', { id: `eq.${_gasto.id}` }, d);
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast(esAdmin() ? 'Gasto confirmado' : 'Guardado: lo confirma un administrador'); _gasto = null; resolver(); }
  },
  async peCerrarMes() {
    const mes = leer('hub_pe_mes_cierre', mesActual());
    if (!confirm(`¿Cerrar ${mes}? Queda como cerrado para la gestoría.`)) return;
    const r = await API.upsert('cierres_mes', 'mes', { mes: `${mes}-01`, estado: 'cerrado', cerrado_at: new Date().toISOString(), cerrado_por: usuario()?.id, nota: val('pe-cierre-nota') || null });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast('Mes cerrado'); resolver(); }
  },
});

async function contador(): Promise<Contador | null> {
  const [aus, gas] = await Promise.all([
    esAdmin() ? API.contar('ausencias', { estado: 'eq.solicitada' }) : API.contar('ausencias', { estado: 'eq.solicitada', usuario_id: `eq.${usuario()?.id}` }),
    API.contar('tickets_gasto', { estado: 'in.(revisar,error)' }),
  ]);
  if (aus == null) return null;
  const n = aus + (gas ?? 0);
  return { valor: n, subtitulo: esAdmin() ? `${pl(aus, 'ausencia', 'ausencias')} por decidir · ${pl(gas ?? 0, 'gasto', 'gastos')} por revisar` : 'cosas tuyas pendientes', tono: n ? 'aviso' : 'bien' };
}

export const moduloPersonas: Modulo = {
  id: 'personas',
  titulo: 'Personas',
  grupo: 'Organizar',
  icono: '👥',
  explicacion: 'El registro de jornada de cada persona (sale de los fichajes de la app), las vacaciones y ausencias, los gastos (tickets que lee Claude y los gastos y cobros en efectivo de los técnicos) y el cierre de cada mes con la gestoría.',
  pintar,
  contador,
};
