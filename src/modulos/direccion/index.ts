// Puesto de mando (fase 3): #/direccion. Avisos accionables para todos (el
// motor hub.panorama_direccion, el mismo que el bot y los informes) y, solo
// para admins, el dinero: tarjetas, ventas de 12 meses frente al año anterior,
// cuentas grandes y lo último que ha cambiado (hub.auditoria).
// Prefijo de ids: di-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { esAdmin, usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { esc, hace, fechaHora, pl } from '../../ui/dom';
import { iconoHex } from '../../shell/iconos';
import { ico, type IconoLinea } from '../../shell/linea';

export interface Aviso {
  clave: string; tipo: string; gravedad: 'mal' | 'aviso' | 'info'; titulo: string; detalle: string | null;
  importe: number | null; enlace: string | null; fecha: string | null; persona: string | null; dinero: boolean;
}
interface Resumen {
  hoy: string; facturado_mes: number; facturado_mes_anterior_ano: number; cobrado_mes: number; pendiente: number; vencido: number;
  facturas_vencidas: number; presupuestos_enviados: number; presupuestos_aceptados: number; para_facturar: number;
  ventas_mensuales: { mes: string; total: number }[];
  cuentas_grandes: { cliente_zoho_id: string; nombre: string; total: number; pendiente: number | null; facturas: number; ultima: string }[];
  zoho: { ultima_ok: string | null; ultimo_error: string | null } | null;
}

// Cada tipo de aviso con el icono de SU pantalla (los mismos del dock) y el
// verbo de su acción (centro de avisos y puesto de mando). Un tipo nuevo del motor sin entrada aquí sale con su
// inicial y «Abrir».
export const AVISO_PANTALLA: Record<string, { ico: string; accion: string }> = {
  alerta_rmm: { ico: 'monitorizacion', accion: 'Ver el equipo' }, sede_sin_conexion: { ico: 'sitios', accion: 'Ver la sede' },
  factura_vencida: { ico: 'facturacion', accion: 'Reclamar' }, cobro_mantenimiento: { ico: 'mantenimientos', accion: 'Ver el cobro' },
  ticket_sin_asignar: { ico: 'tickets', accion: 'Asignar' }, presupuesto_sin_respuesta: { ico: 'presupuestos', accion: 'Seguir' },
  trabajo_sin_facturar: { ico: 'trabajos', accion: 'Facturar' }, hito_vencido: { ico: 'proyectos', accion: 'Ver el hito' },
  cliente_sin_comprar: { ico: 'clientes', accion: 'Ver el cliente' }, cierre_mes: { ico: 'calendario', accion: 'Ver el cierre' },
};
// `icono`: de reserva (icono de línea) si el tipo no tiene pantalla en AVISO_PANTALLA.
export const GRUPOS: Record<string, { nombre: string; icono?: IconoLinea }> = {
  alerta_rmm: { nombre: 'Alertas de equipos', icono: 'alarma' }, sede_sin_conexion: { nombre: 'Sedes sin conexión', icono: 'antena' },
  factura_vencida: { nombre: 'Facturas vencidas', icono: 'dinero' }, cobro_mantenimiento: { nombre: 'Cobros de mantenimiento', icono: 'repetir' },
  ticket_sin_asignar: { nombre: 'Tickets sin asignar', icono: 'etiqueta' }, presupuesto_sin_respuesta: { nombre: 'Presupuestos sin respuesta', icono: 'documento' },
  trabajo_sin_facturar: { nombre: 'Trabajos por facturar', icono: 'recibo' }, hito_vencido: { nombre: 'Hitos de proyecto vencidos', icono: 'brujula' },
  cliente_sin_comprar: { nombre: 'Clientes importantes sin comprar', icono: 'trato' }, cierre_mes: { nombre: 'Cierre del mes', icono: 'calendario' },
};
const PESO = { mal: 0, aviso: 1, info: 2 } as const;
const CLAVE_MIOS = 'hub_direccion_mios';

const eur = (n: number | null | undefined, dec = 0) =>
  `${Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })} €`;
const leer = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

// Lo que en la app guarda un técnico por NOMBRE vale con el completo o el de pila.
const norm = (v: string | null | undefined) => (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function esMio(persona: string | null): boolean {
  const n = norm(usuario()?.nombre);
  const g = norm(persona);
  return !!g && (g === n || g === n.split(/\s+/)[0]);
}

export async function avisos() {
  return API.rpc<Aviso[]>('panorama_direccion');
}

function botonEnlace(a: Aviso): string {
  if (!a.enlace) return '';
  const interno = a.enlace.startsWith('#');
  const texto = a.enlace.includes('zoho.eu') ? `Zoho ${ico('externo')}` : interno ? 'Abrir' : `App ${ico('externo')}`;
  return `<a class="btn secundario" href="${esc(a.enlace)}"${interno ? '' : ' target="_blank" rel="noopener"'}>${texto}</a>`;
}

function pintarAvisos(lista: Aviso[], soloMios: boolean): string {
  const filtrada = soloMios ? lista.filter(a => esMio(a.persona)) : lista;
  const barra = `<div class="acciones di-barra"><div class="segmentado" role="tablist">
      <button role="tab" aria-selected="${!soloMios}" class="${soloMios ? '' : 'activo'}" data-action="diMios" data-p0="0">Todos (${lista.length})</button>
      <button role="tab" aria-selected="${soloMios}" class="${soloMios ? 'activo' : ''}" data-action="diMios" data-p0="1">Los míos (${lista.filter(a => esMio(a.persona)).length})</button>
    </div></div>`;
  if (!filtrada.length) return `${barra}<p class="vacio">${ico('hecho')} Nada pendiente${soloMios ? ' a tu nombre' : ''}.</p>`;
  const grupos = new Map<string, Aviso[]>();
  for (const a of filtrada) grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);
  const orden = [...grupos.entries()].sort((x, y) =>
    Math.min(...x[1].map(a => PESO[a.gravedad])) - Math.min(...y[1].map(a => PESO[a.gravedad])) || y[1].length - x[1].length);
  return barra + orden.map(([tipo, fs], i) => {
    const g: { nombre: string; icono?: IconoLinea } = GRUPOS[tipo] ?? { nombre: tipo };
    const suma = fs.reduce((s, a) => s + Number(a.importe ?? 0), 0);
    const peor = fs.some(a => a.gravedad === 'mal') ? 'mal' : fs.some(a => a.gravedad === 'aviso') ? 'aviso' : 'neutro';
    fs.sort((a, b) => PESO[a.gravedad] - PESO[b.gravedad] || Number(b.importe ?? 0) - Number(a.importe ?? 0));
    return `<details class="tarjeta di-grupo di-g-${peor}" ${i < 4 ? 'open' : ''} data-tipo="${esc(tipo)}">
      <summary><span class="di-grupo-tit">${AVISO_PANTALLA[tipo] ? iconoHex(AVISO_PANTALLA[tipo].ico, g.nombre, 'di-grupo-ico') : g.icono ? ico(g.icono) : '•'} <strong>${esc(g.nombre)}</strong></span>
        <span class="chip ${peor}">${fs.length}</span>${suma ? `<span class="di-suma">${eur(suma)}</span>` : ''}</summary>
      <ul class="di-lista">${fs.map(a => `<li class="di-aviso">
        <span class="di-punto g-${esc(a.gravedad)}" aria-label="${a.gravedad === 'mal' ? 'Urgente' : a.gravedad === 'aviso' ? 'Pendiente' : 'Información'}"></span>
        <div class="di-texto"><strong>${esc(a.titulo.replace(/^[^:]+: /, ''))}</strong>
          ${a.detalle ? `<br><small class="nota">${esc(a.detalle)}</small>` : ''}${a.persona ? ` <small class="chip">${esc(a.persona)}</small>` : ''}</div>
        ${a.importe ? `<span class="di-importe">${eur(a.importe, 2)}</span>` : ''}
        ${botonEnlace(a)}
      </li>`).join('')}</ul></details>`;
  }).join('');
}

function tarjeta(titulo: string, valor: string, sub: string, tono = ''): string {
  return `<article class="tarjeta di-cifra ${tono}"><h3>${esc(titulo)}</h3><p class="di-valor">${valor}</p><p class="nota">${sub}</p></article>`;
}

function pintarCifras(r: Resumen): string {
  const dif = r.facturado_mes_anterior_ano ? (r.facturado_mes - r.facturado_mes_anterior_ano) / r.facturado_mes_anterior_ano * 100 : null;
  return `<div class="di-cifras">
    ${tarjeta('Facturado este mes', eur(r.facturado_mes), dif == null ? 'Sin datos del año pasado'
      : `${dif >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(dif))} % frente a ${eur(r.facturado_mes_anterior_ano)} el año pasado a estas alturas`)}
    ${tarjeta('Cobrado este mes', eur(r.cobrado_mes), 'Pagos registrados en Zoho')}
    ${tarjeta('Pendiente de cobro', eur(r.pendiente), r.vencido ? `<span class="mal">${eur(r.vencido)} vencido</span> en ${pl(r.facturas_vencidas, 'factura', 'facturas')}` : 'Nada vencido', r.vencido ? 'mal' : '')}
    ${tarjeta('Presupuestos', eur(r.presupuestos_enviados), `enviados sin respuesta · ${eur(r.presupuestos_aceptados)} aceptados · ${pl(r.para_facturar, 'trabajo', 'trabajos')} por facturar`)}
  </div><p class="nota di-pie">Importes con impuestos, como en Zoho Books. Última copia de Zoho: ${r.zoho?.ultima_ok ? esc(hace(r.zoho.ultima_ok)) : 'nunca'}${r.zoho?.ultimo_error ? ` · <span class="mal">último error: ${esc(r.zoho.ultimo_error)}</span>` : ''}.</p>`;
}

// ── Ventas: barras de los últimos 12 meses y línea del año anterior ─────────
const G = { ancho: 440, alto: 210, izq: 40, abajo: 24, arriba: 20 };
let _ventas: { mes: string; actual: number; anterior: number }[] = [];
function pintarVentas(r: Resumen): string {
  const v = r.ventas_mensuales;
  if (v.length < 24) return '';
  _ventas = v.slice(12).map((m, i) => ({ mes: m.mes, actual: Number(m.total), anterior: Number(v[i].total) }));
  const max = Math.max(1, ..._ventas.flatMap(m => [m.actual, m.anterior]));
  const paso = Math.pow(10, Math.floor(Math.log10(max))); const tope = Math.ceil(max / paso) * paso;
  const ancho = G.ancho - G.izq, alto = G.alto - G.abajo - G.arriba, col = ancho / 12;
  const y = (n: number) => G.arriba + alto - (n / tope) * alto;
  const mesCorto = (m: string) => new Date(`${m}-15`).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
  const rejilla = [0, 0.5, 1].map(f => `<line class="di-rejilla" x1="${G.izq}" x2="${G.ancho}" y1="${y(tope * f)}" y2="${y(tope * f)}"/>
    <text class="di-eje" x="${G.izq - 6}" y="${y(tope * f) + 4}" text-anchor="end">${Math.round(tope * f / 1000)}k</text>`).join('');
  const barras = _ventas.map((m, i) => {
    const x = G.izq + i * col + col * 0.2, w = col * 0.6, h = Math.max(0, y(0) - y(m.actual));
    return `<path class="di-col" d="M${x},${y(0)} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${w - 8} q4,0 4,4 v${Math.max(0, h - 4)} z"/>
      <text class="di-eje" x="${x + w / 2}" y="${G.alto - 8}" text-anchor="middle">${esc(mesCorto(m.mes))}</text>`;
  }).join('');
  const puntos = _ventas.map((m, i) => `${G.izq + i * col + col / 2},${y(m.anterior)}`);
  const ult = _ventas[_ventas.length - 1];
  const totalA = _ventas.reduce((s, m) => s + m.actual, 0), totalB = _ventas.reduce((s, m) => s + m.anterior, 0);
  return `<section class="tarjeta di-ventas">
    <div class="tarjeta-cab"><h3>Ventas por mes</h3>
      <div class="di-leyenda"><span><i class="di-l-actual"></i>Últimos 12 meses · ${eur(totalA)}</span>
        <span><i class="di-l-anterior"></i>12 meses anteriores · ${eur(totalB)}</span></div></div>
    <div class="di-graf" data-on-pointermove="diVentasHover:$this,$event" data-on-pointerout="diVentasFuera:$this,$event">
      <svg viewBox="0 0 ${G.ancho} ${G.alto}" role="img" aria-label="Facturación por mes, últimos 12 meses frente a los 12 anteriores">
        ${rejilla}${barras}
        <polyline class="di-linea" points="${puntos.join(' ')}"/>
        ${puntos.map(p => `<circle class="di-marca" cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="4"/>`).join('')}
        <text class="di-etiqueta" x="${G.ancho}" y="${Math.min(y(ult.actual), y(ult.anterior)) - 8}" text-anchor="end">${eur(ult.actual)}</text>
      </svg>
      <div class="di-tip" hidden></div>
    </div>
    <details class="di-tabla"><summary>Ver como tabla</summary><table class="tabla"><thead><tr><th>Mes</th><th>Facturado</th><th>Un año antes</th></tr></thead>
      <tbody>${_ventas.map(m => `<tr><td>${esc(m.mes)}</td><td>${eur(m.actual)}</td><td>${eur(m.anterior)}</td></tr>`).join('')}</tbody></table></details>
  </section>`;
}

function pintarCuentas(r: Resumen): string {
  if (!r.cuentas_grandes.length) return '';
  return `<section class="tarjeta"><h3>Cuentas grandes (12 meses)</h3><div class="mo-scroll"><table class="tabla">
    <thead><tr><th>Cliente</th><th>Facturado</th><th>Pendiente</th><th>Facturas</th><th>Última</th></tr></thead>
    <tbody>${r.cuentas_grandes.map(c => `<tr><td><a href="https://books.zoho.eu/app/20107733530#/contacts/${esc(c.cliente_zoho_id)}" target="_blank" rel="noopener">${esc(c.nombre)}</a></td>
      <td>${eur(c.total)}</td><td class="${c.pendiente ? 'aviso' : ''}">${c.pendiente ? eur(c.pendiente, 2) : '—'}</td><td>${c.facturas}</td><td>${esc(c.ultima)}</td></tr>`).join('')}</tbody>
  </table></div></section>`;
}

async function pintarUltimo(): Promise<string> {
  const { data } = await API.get<any[]>('auditoria', { select: 'ts,tabla,accion,usuario_nombre,usuario_email,origen,titulo', order: 'id.desc', limit: '15' });
  if (!data?.length) return '';
  const accion: Record<string, string> = { INSERT: 'creó', UPDATE: 'cambió', DELETE: 'borró' };
  return `<section class="tarjeta"><h3>Lo último en el hub</h3><ul class="di-ultimo">${data.map(a => `<li>
    <small class="nota" title="${esc(fechaHora(a.ts))}">${esc(hace(a.ts))}</small>
    <span><strong>${esc(a.usuario_nombre ?? a.usuario_email ?? a.origen ?? 'Sistema')}</strong> ${esc(accion[a.accion] ?? a.accion)}
    ${esc(a.tabla.replace(/_/g, ' '))}${a.titulo ? ` «${esc(a.titulo)}»` : ''}</span></li>`).join('')}</ul></section>`;
}

async function pintar(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const soloMios = leer(CLAVE_MIOS) === '1';
  const [av, res] = await Promise.all([avisos(), esAdmin() ? API.rpc<Resumen | null>('direccion_resumen') : Promise.resolve({ data: null, error: null })]);
  if (av.error) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los avisos: ${esc(av.error.message)}</p>`; return; }
  const r = res.data;
  const sinZoho = esAdmin() && (!r?.zoho?.ultima_ok);
  el.innerHTML = `
    ${sinZoho ? '<p class="aviso">Las cifras de dinero salen de Zoho Books, que aún no está conectado al hub. <a href="#/datos">Conectarlo en Datos y sincronización</a>.</p>' : ''}
    ${r && !sinZoho ? pintarCifras(r) : ''}
    <div class="di-cuerpo">
      <section class="di-avisos"><h2>Avisos</h2>${pintarAvisos(av.data ?? [], soloMios)}</section>
      ${esAdmin() ? `<div class="di-lateral">${r && !sinZoho ? pintarVentas(r) + pintarCuentas(r) : ''}${await pintarUltimo()}</div>` : ''}
    </div>`;
}

async function contador(): Promise<Contador | null> {
  const { data, error } = await avisos();
  if (error || !data) return null;
  const mal = data.filter(a => a.gravedad === 'mal').length;
  return { valor: data.length, subtitulo: mal ? `${pl(mal, 'urgente', 'urgentes')}` : 'avisos pendientes', tono: mal ? 'mal' : data.length ? 'aviso' : 'bien' };
}

registrarAcciones({
  diMios(v: string) { guardar(CLAVE_MIOS, v); resolver(); },
  diVentasHover(caja: HTMLElement, ev: PointerEvent) {
    const tip = caja.querySelector<HTMLElement>('.di-tip');
    if (!tip || !_ventas.length) return;
    const r = caja.getBoundingClientRect();
    const escala = r.width / G.ancho;
    const x = (ev.clientX - r.left) / escala - G.izq;
    const i = Math.min(11, Math.max(0, Math.floor(x / ((G.ancho - G.izq) / 12))));
    const m = _ventas[i];
    tip.hidden = false;
    tip.innerHTML = `<strong>${esc(new Date(`${m.mes}-15`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }))}</strong><br>
      <i class="di-l-actual"></i>${eur(m.actual)}<br><i class="di-l-anterior"></i>${eur(m.anterior)} un año antes`;
    const px = (G.izq + (i + 0.5) * (G.ancho - G.izq) / 12) * escala;
    tip.style.left = `${Math.min(Math.max(px, 90), r.width - 90)}px`;
  },
  diVentasFuera(caja: HTMLElement, ev: PointerEvent) {
    if (ev.relatedTarget instanceof Node && caja.contains(ev.relatedTarget)) return;
    const tip = caja.querySelector<HTMLElement>('.di-tip');
    if (tip) tip.hidden = true;
  },
});

export const moduloDireccion: Modulo = {
  id: 'direccion',
  titulo: 'Puesto de mando',
  grupo: 'General',
  icono: '🎯',
  explicacion: 'Lo que pide que alguien haga algo, junto: presupuestos sin respuesta, trabajos por facturar, tickets sin asignar, alertas de equipos, hitos vencidos y, para administración, facturas vencidas, cobros de mantenimiento torcidos y clientes importantes que han dejado de comprar. Es la misma lista que manda el bot de Telegram.',
  pintar,
  contador,
};
