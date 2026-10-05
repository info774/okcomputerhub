// Cobros del mantenimiento (pestaña «Cobros» de la app, mant-cobros.js):
//   #/mantenimientos/cobros               cuadro de sedes, cifras y libro de cuotas
//   #/mantenimientos/cobros/sede/<id>     el cobro de UNA sede y sus cuotas (el
//                                         panel «Mant.» de la ficha del sitio)
//   #/mantenimientos/cobros/cambiar/<id>  cambiar plan / importe / frecuencia
//   #/mantenimientos/cobros/abonar/<id>   abonar una cuota (saldo a favor)
//   #/mantenimientos/cobros/ajustes       ajustes de facturación (serie, impuesto…)
// Solo administración. Aquí NO se habla con Stripe: todo va por la función
// `stripe-suscripcion` (la clave secreta no sale del servidor), que contesta
// 409 mientras el área `mantenimiento` sea de la app: hasta el corte, esto se
// ve y no se toca (decisión de Fran: preparado, sin conectar).
// Reglas de la app: los importes son NETOS y Stripe cobra neto × meses + el
// impuesto; Stripe COBRA y Zoho FACTURA (serie MANT-); una cuota se abona, no
// se toca. Prefijos de ids: mcb- (cuadro), mcc- (cambiar), mab- (abonar),
// mcfg- (ajustes).
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { navPestanas, olvidarMantenimientos } from './vista';
import { sedeEnZoho, sinAcentos, FRECUENCIAS, normalizaFrecuencia, mesesDe, fechaCorta, IGIC, urlZohoBilling } from './datos';
import { planesActivos } from './planes';

interface Cobro {
  local_id: string; local_nombre: string | null; cliente_id: string | null; cliente_nombre: string | null; cliente_email: string | null;
  plan: string | null; importe_mantenimiento: number | null; importe_incluye_impuesto: boolean | null; frecuencia_pago: string | null;
  estado_pago: string | null; forma_pago: string | null; proxima_cuota: string | null; stripe_subscription_id: string | null; stripe_estado: string | null;
  stripe_mandato_estado: string | null; stripe_ultimo_error: string | null; stripe_cobro_en_curso_at: string | null; stripe_sync_at: string | null;
  zoho_subscription_id: string | null; zoho_estado: string | null; zoho_deuda: number | null; zoho_facturas_impagadas: number | null;
  zoho_sync_error: string | null; ultima_factura_numero: string | null; ultima_factura_zoho_estado: string | null;
}
interface Factura {
  id: string; created_at: string; local_id: string | null; numero_serie: string | null; importe: number | null; estado: string; fecha_emision: string | null;
  periodo_inicio: string | null; periodo_fin: string | null; zoho_invoice_id: string | null; zoho_invoice_number: string | null; zoho_estado: string | null;
  zoho_error: string | null; error_pago: string | null; email_enviado_at: string | null; email_destinatarios: string[] | null; stripe_invoice_id: string | null;
  stripe_pdf_url: string | null; tipo: string | null; saldo_aplicado: number | null;
}
interface Abono { id: string; factura_id: string; numero_serie: string | null; importe: number; motivo: string; zoho_creditnote_number: string | null;
  stripe_balance_txn_id: string | null; zoho_error: string | null; stripe_error: string | null }
interface Config { serie_prefijo: string; serie_digitos: number; precio_incluye_impuesto: boolean; zoho_tax_id: string | null; zoho_tax_percent: number | null;
  zoho_cuenta_cobro_id: string | null; zoho_notas: string | null; facturar_automatico: boolean; enviar_factura_email: boolean; pago_metodos: string[] | null }

let _cobros: Cobro[] = [];
let _facturas: Factura[] = [];
let _abonos: Abono[] = [];
let _cfg: Config | null = null;
let _filtro = '';
let _q = '';
let _escribe = false;
let _enlace: { url: string; sede: Cobro | null; caduca: string | null } | null = null;
let _divergentes: { sede: string; app: number; stripe: number }[] = [];
// Lo último que contestó Zoho Billing al «Comprobar en Zoho» de una sede.
interface ZohoComprobado { local: string; sede: string; no_existe?: boolean; guardado: boolean; mensaje?: string; status?: string; plan?: string | null;
  estado_pago?: string; deuda?: number | null; facturas_impagadas?: number | null; deuda_error?: string | null; importe?: number | null; proxima_cuota?: string | null; url?: string }
let _zoho: ZohoComprobado | null = null;
let _timer: number | undefined;

const DIAS_SEPA = 10;
const IMPAGO = new Set(['past_due', 'unpaid']);
const ESTADO_STRIPE: Record<string, [string, string]> = {
  active: ['Activa', 'bien'], trialing: ['En prueba', ''], past_due: ['Recibo devuelto', 'mal'], unpaid: ['Impagada', 'mal'], paused: ['Pausada', ''],
  incomplete: ['Falta el primer pago', 'aviso'], incomplete_expired: ['Caducada', 'mal'], canceled: ['Cancelada', ''],
};
const ESTADO_FACTURA: Record<string, [string, string]> = {
  pagada: ['Cobrada', 'bien'], pendiente: ['En curso', ''], fallida: ['Devuelta', 'mal'], cancelada: ['Sin pagar', ''], reembolsada: ['Reembolsada', 'aviso'],
};
const FILTROS: [string, string][] = [['', 'Todas'], ['sin_domiciliar', 'Sin domiciliar'], ['sin_mandato', 'Sin medio de pago'], ['impagados', 'Recibos devueltos'], ['activos', 'Activas']];

const euros = (n: number | null | undefined) => n == null ? '—' : Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const pct = () => _cfg?.zoho_tax_percent != null ? Number(_cfg.zoho_tax_percent) : IGIC;
// Lo que se le carga de verdad: neto + impuesto (salvo que el precio ya lo lleve).
const conImpuesto = (neto: number) => _cfg?.precio_incluye_impuesto ? neto : neto * (1 + pct() / 100);
// La cuota NETA de la sede (netoSede de la app): el bruto heredado de Zoho, sin el impuesto.
const netoSede = (c: Cobro) => {
  const g = Number(c.importe_mantenimiento ?? 0);
  if (!g || !c.importe_incluye_impuesto) return g;
  return Math.round((_cfg?.precio_incluye_impuesto ? g : g / (1 + pct() / 100)) * 100) / 100;
};
const cada = (f: string | null) => ({ Mensual: 'cada mes', Trimestral: 'cada trimestre', Semestral: 'cada semestre', Anual: 'cada año' } as Record<string, string>)[normalizaFrecuencia(f) ?? 'Mensual'];
const esStripe = (c: Cobro) => !!c.stripe_subscription_id;
const zohoDeBaja = (c: Cobro) => !!c.zoho_subscription_id && !c.stripe_subscription_id && !sedeEnZoho(c);
const sinCobro = (c: Cobro) => !esStripe(c) && !sedeEnZoho(c);
const deudaPlan = (c: Cobro) => !!c.plan && c.plan !== 'Sin mantenimiento';
const chip = (t: string, tono = '') => `<span class="chip ${tono}">${t}</span>`;
const dis = () => (_escribe ? '' : ' disabled');

async function cargar(localId?: string) {
  const f: Record<string, string> = localId ? { local_id: `eq.${localId}` } : {};
  const [cs, fs, cfg, ab] = await Promise.all([
    API.fetchAll<Cobro>('mant_cobros_estado', { select: '*', ...f, order: 'proxima_cuota.asc.nullslast' }),
    API.get<Factura[]>('mant_facturas', { select: '*', ...f, order: 'created_at.desc', limit: localId ? '36' : '100' }),
    API.single<Config>('mant_config', { select: '*', id: 'eq.true' }),
    API.get<Abono[]>('mant_abonos', { select: '*', ...f, order: 'created_at.desc', limit: '100' }),
  ]);
  _cobros = cs.data ?? []; _facturas = fs.data ?? []; _cfg = cfg.data ?? null; _abonos = ab.data ?? [];
  return cs.error ?? fs.error ?? null;
}

export async function pintarCobros(el: HTMLElement, sub?: string, id?: string) {
  if (!esAdmin()) { el.innerHTML = `${navPestanas('cobros')}<p class="aviso">Los cobros de las cuotas son solo para administración.</p>`; return; }
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  _escribe = await esDelHub('mant_facturas', 'locales');
  if (sub === 'ajustes') return pintarAjustes(el);
  if (sub === 'cambiar' && id) return pintarCambiar(el, id);
  if (sub === 'abonar' && id) return pintarAbonar(el, id);
  const error = await cargar(sub === 'sede' ? id : undefined);
  if (error) { el.innerHTML = `<p class="aviso mal">No se pudo leer el cuadro de cobros: ${esc(error.message)}</p>`; return; }
  if (sub === 'sede' && id) return pintarSede(el, id);
  const lista = _cobros.filter(deudaPlan);
  const enStripe = lista.filter(esStripe), sinDom = lista.filter(sinCobro);
  const sinPagar = lista.filter(c => esStripe(c) && c.stripe_mandato_estado !== 'activo');
  const impagados = lista.filter(c => esStripe(c) && IMPAGO.has(c.stripe_estado ?? ''));
  const mes = new Date().toLocaleDateString('sv-SE').slice(0, 7);
  const cobradoMes = _facturas.filter(f => f.estado === 'pagada' && (f.fecha_emision || f.created_at || '').slice(0, 7) === mes).reduce((s, f) => s + Number(f.importe || 0), 0);
  const sinFacturar = _facturas.filter(f => f.estado === 'pagada' && !f.zoho_invoice_id);
  const enCurso = _cobros.filter(c => c.stripe_cobro_en_curso_at);
  const lentos = enCurso.filter(c => (Date.now() - Date.parse(c.stripe_cobro_en_curso_at!)) / 86_400_000 > DIAS_SEPA);
  const kpi = (v: string, t: string, tono = '', alerta = '') => `<article class="tarjeta di-cifra ${tono}"><h3>${esc(t)}</h3><p class="di-valor">${v}</p>${alerta ? `<p class="g-mal">${esc(alerta)}</p>` : ''}</article>`;
  let vistos = lista;
  if (_filtro === 'sin_domiciliar') vistos = vistos.filter(sinCobro);
  if (_filtro === 'sin_mandato') vistos = vistos.filter(c => esStripe(c) && c.stripe_mandato_estado !== 'activo');
  if (_filtro === 'impagados') vistos = vistos.filter(c => esStripe(c) && IMPAGO.has(c.stripe_estado ?? ''));
  if (_filtro === 'activos') vistos = vistos.filter(c => esStripe(c) && c.stripe_estado === 'active');
  const q = sinAcentos(_q);
  const coincide = (c: Cobro) => [c.cliente_nombre, c.local_nombre, c.plan].some(x => sinAcentos(x).includes(q));
  if (q) vistos = vistos.filter(coincide);
  const sedePor = new Map(_cobros.map(c => [c.local_id, c]));
  const facturas = q ? _facturas.filter(f => sinAcentos(f.numero_serie).includes(q) || sinAcentos(f.zoho_invoice_number).includes(q) || (sedePor.has(f.local_id ?? '') && coincide(sedePor.get(f.local_id!)!))) : _facturas;
  el.innerHTML = `${_escribe ? '' : avisoSoloLectura('El cobro de las cuotas')}${navPestanas('cobros')}
    ${panelEnlace()}${panelDivergentes()}${panelZoho()}
    <div class="di-cifras pp-cifras mcb-cifras">
      ${kpi(euros(enStripe.reduce((s, c) => s + netoSede(c), 0)), `Cuota mensual domiciliada (${_cfg?.precio_incluye_impuesto ? 'con impuestos' : `sin impuestos · +${pct()} %`})`)}
      ${kpi(euros(cobradoMes), 'Cobrado este mes (con impuestos)', 'bien')}
      ${kpi(String(enStripe.length), 'Sedes con cobro en Stripe', '', sinDom.length ? `${sinDom.length} sin domiciliar` : '')}
      ${kpi(String(sinPagar.length), 'Altas sin pagar / sin medio de pago', sinPagar.length ? 'atento' : 'bien')}
      ${enCurso.length ? kpi(String(enCurso.length), 'Cobros en curso (SEPA, ~6 días)', lentos.length ? 'atento' : '', lentos.length ? `${lentos.length} sin liquidar hace más de ${DIAS_SEPA} días` : '') : ''}
      ${kpi(String(impagados.length), 'Recibos devueltos', impagados.length ? 'mal' : 'bien')}
      ${kpi(String(sinFacturar.length), 'Cobros sin factura en Zoho', sinFacturar.length ? 'mal' : 'bien')}</div>
    <div class="acciones mo-barra"><button class="btn secundario" data-action="mcbSync"${dis()}>${ico('descargar')} Traer estado de Stripe</button>
      <a class="btn secundario" href="#/mantenimientos/cobros/ajustes">${ico('ajustes')} Ajustes de facturación</a>
      <a class="btn secundario" href="https://dashboard.stripe.com/subscriptions" target="_blank" rel="noopener">${ico('externo')} Panel de Stripe</a></div>
    <div class="acciones mo-barra"><input id="mcb-q" type="search" placeholder="Buscar cliente, sede, plan o número de factura…" value="${esc(_q)}" data-on-input="mcbBuscar:$value" aria-label="Buscar">
      ${FILTROS.map(([k, n]) => `<button class="chip-boton ${_filtro === k ? 'activo' : ''}" data-action="mcbFiltro" data-p0="${k}" aria-pressed="${_filtro === k}">${n}</button>`).join('')}</div>
    <section class="tarjeta"><h3>Sedes</h3>${vistos.length ? `<ul class="mdo-lista" id="mcb-sedes">${vistos.map(filaSede).join('')}</ul>`
      : `<p class="vacio">${q ? `Ninguna sede coincide con «${esc(_q)}».` : _filtro ? 'Ninguna sede cumple este filtro.' : 'Ninguna sede con plan de mantenimiento todavía.'}</p>`}</section>
    <section class="tarjeta"><h3>Libro de cuotas</h3>${facturas.length ? `<ul class="mdo-lista" id="mcb-libro">${facturas.slice(0, 50).map(f => {
      const s = sedePor.get(f.local_id ?? '');
      return `<li data-factura="${esc(f.id)}"><div class="mdo-cab">${f.numero_serie ? `<strong>${esc(f.numero_serie)}</strong> ` : ''}<span>${esc([s?.cliente_nombre, s?.local_nombre].filter(Boolean).join(' · ') || '—')}</span></div>${filaFactura(f)}</li>`;
    }).join('')}</ul>` : `<p class="vacio">${q ? `Ninguna cuota coincide con «${esc(_q)}».` : 'Todavía no se ha cobrado ninguna cuota.'}</p>`}</section>`;
}

function chipsSede(c: Cobro): string {
  const plan = chip(esc(c.plan ?? ''));
  if (esStripe(c)) {
    const [t, tono] = ESTADO_STRIPE[c.stripe_estado ?? ''] ?? ['', ''];
    return [plan, t ? chip(t, tono) : '', c.stripe_mandato_estado !== 'activo' ? chip(`${ico('atencion')} Falta el medio de pago`, 'aviso') : chip('Tarjeta o SEPA'), chipEnCurso(c)].join(' ');
  }
  if (c.zoho_subscription_id) {
    return [plan, chip('Zoho Billing'), zohoDeBaja(c) ? chip('Baja en Zoho · ya no cobra') : c.zoho_estado ? chip(esc(c.zoho_estado)) : '',
      Number(c.zoho_deuda) > 0 ? chip(`${ico('atencion')} Debe ${euros(c.zoho_deuda)}${c.zoho_facturas_impagadas ? ` (${c.zoho_facturas_impagadas})` : ''}`, 'mal')
        : c.zoho_sync_error ? `<span class="chip aviso" title="${esc(c.zoho_sync_error)}">Sin comprobar en Zoho</span>` : ''].join(' ');
  }
  return `${plan} ${chip('Sin domiciliar', 'aviso')}`;
}

function chipEnCurso(c: Cobro): string {
  if (!c.stripe_cobro_en_curso_at) return '';
  const dias = Math.floor((Date.now() - Date.parse(c.stripe_cobro_en_curso_at)) / 86_400_000);
  return `<span class="chip ${dias > DIAS_SEPA ? 'aviso' : ''}" title="Con SEPA el adeudo tarda unos 6 días hábiles; hasta entonces no hay factura de Zoho.">${ico('espera')} ${dias > DIAS_SEPA ? `Cobro sin liquidar (${dias} días)` : 'Cobro en curso'}</span>`;
}

// Los botones de una sede según quién la cobra (los MISMOS en el cuadro y en su página).
function botonesSede(c: Cobro): string {
  const id = esc(c.local_id), d = dis();
  if (esStripe(c)) {
    const ok = c.stripe_mandato_estado === 'activo';
    return `${ok ? '' : `<button class="btn" data-action="mcbMandato" data-p0="${id}"${d}>${ico('enlace')} Enlace de pago</button>`}
      <a class="btn secundario" href="#/mantenimientos/cobros/sede/${id}">${ico('recibo')} Cuotas</a>
      <a class="btn secundario" href="#/mantenimientos/cobros/cambiar/${id}">${ico('editar')} Cambiar plan</a>
      ${ok ? `<button class="btn secundario" data-action="mcbMandato" data-p0="${id}"${d}>${ico('banco')} Cambiar medio de pago</button>` : ''}
      <button class="btn secundario" data-action="mcbPortal" data-p0="${id}"${d}>${ico('persona')} Portal cliente</button>
      ${c.stripe_estado === 'paused' ? `<button class="btn secundario" data-action="mcbReanudar" data-p0="${id}"${d}>${ico('play')} Reanudar</button>`
        : `<button class="btn secundario" data-action="mcbPausar" data-p0="${id}"${d}>${ico('pausa')} Pausar</button>`}
      <button class="btn peligro" data-action="mcbCancelar" data-p0="${id}"${d}>✕ Dar de baja</button>`;
  }
  // Cartera vieja de Zoho Billing: la cobra Zoho; aquí solo se mira y se desvincula (tanda 4: comprobar).
  // «Comprobar en Zoho» vale ya (solo lee; con el corte, además guarda en la sede).
  const comprobar = c.zoho_subscription_id ? `<button class="btn secundario" data-action="mcbComprobarZoho" data-p0="${id}">${ico('descargar')} Comprobar en Zoho</button>` : '';
  if (sedeEnZoho(c)) return `<a class="btn secundario" href="${esc(urlZohoBilling(c.zoho_subscription_id))}" target="_blank" rel="noopener">${ico('externo')} Ver en Zoho</a> ${comprobar}
      <button class="btn secundario" data-action="mcbDesvincular" data-p0="${id}"${d}>Desvincular de Zoho</button>`;
  return `<button class="btn" data-action="mcbCrear" data-p0="${id}"${d}>＋ Domiciliar</button>${zohoDeBaja(c) ? ` ${comprobar} <button class="btn secundario" data-action="mcbDesvincular" data-p0="${id}"${d}>Desvincular de Zoho</button>` : ''}`;
}

function filaSede(c: Cobro): string {
  const neto = netoSede(c), bruto = conImpuesto(neto * mesesDe(c.frecuencia_pago));
  return `<li data-sede="${esc(c.local_id)}"><div class="mdo-cab"><a href="#/mantenimientos/cobros/sede/${esc(c.local_id)}"><strong>${esc(c.cliente_nombre || '—')}</strong> · ${esc(c.local_nombre || '—')}</a></div>
    <p class="mdo-cab">${chipsSede(c)} ${neto ? `<span>${euros(neto)}/mes${c.frecuencia_pago ? ` · ${esc(normalizaFrecuencia(c.frecuencia_pago) ?? c.frecuencia_pago)}` : ''}</span> <small class="nota">se cargan ${euros(bruto)} ${cada(c.frecuencia_pago)}</small>` : ''}</p>
    <p class="nota">${c.proxima_cuota && esStripe(c) ? `${ico('calendario')} Próx. cuota ${esc(fechaCorta(c.proxima_cuota))}` : ''}${c.ultima_factura_numero ? ` · Últ. factura ${esc(c.ultima_factura_numero)}${c.ultima_factura_zoho_estado === 'error' ? ` ${ico('atencion')}` : ''}` : ''}</p>
    ${c.stripe_ultimo_error ? `<p class="g-mal">${ico('atencion')} ${esc(c.stripe_ultimo_error)}</p>` : ''}
    <div class="acciones">${botonesSede(c)}</div></li>`;
}

// Una cuota del libro: la MISMA fila en el cuadro y en la página de la sede.
function filaFactura(f: Factura): string {
  const [t, tono] = ESTADO_FACTURA[f.estado] ?? [f.estado, ''];
  const abonos = _abonos.filter(a => a.factura_id === f.id);
  const abonado = abonos.reduce((s, a) => s + Number(a.importe || 0), 0);
  const abonable = Math.round((Number(f.importe || 0) - abonado) * 100) / 100;
  const zoho = f.zoho_invoice_id ? chip(`Zoho ${esc(f.zoho_invoice_number ?? '✓')}`, 'bien') : f.zoho_estado === 'error' ? chip(`${ico('atencion')} Sin facturar`, 'mal') : f.estado === 'pagada' ? chip('Pendiente de emitir', 'aviso') : '';
  const correo = !f.zoho_invoice_id ? '' : f.email_enviado_at ? `<span class="chip bien" title="${esc((f.email_destinatarios ?? []).join(', '))}">${ico('correo')} Enviada al cliente</span>` : chip('Sin enviar', 'aviso');
  // Stripe COBRA, no factura: su PDF es un apunte interno, no la factura del cliente.
  const interno = f.stripe_invoice_id ? `<small class="nota">Stripe${f.tipo === 'alta' ? ' · 1ª cuota' : ''}${f.stripe_pdf_url && /^https:\/\//.test(f.stripe_pdf_url) ? ` · <a href="${esc(f.stripe_pdf_url)}" target="_blank" rel="noopener" title="Apunte interno del cobro en Stripe. La factura del cliente es la de Zoho (serie MANT-).">cobro interno</a>` : ''}</small>` : '';
  return `<p class="mdo-cab"><strong>${euros(f.importe)}</strong> ${chip(esc(t), tono)} ${zoho} ${correo} ${interno}
      <small class="nota">${esc(fechaCorta(f.fecha_emision || f.created_at))}${f.periodo_inicio && f.periodo_fin ? ` · ${esc(fechaCorta(f.periodo_inicio))} – ${esc(fechaCorta(f.periodo_fin))}` : ''}</small>
      ${Number(f.saldo_aplicado) > 0.005 ? `<small class="nota">${euros(Number(f.importe) - Number(f.saldo_aplicado))} en efectivo · ${euros(f.saldo_aplicado)} de saldo</small>` : ''}</p>
    ${f.error_pago ? `<p class="g-mal">${esc(f.error_pago)}</p>` : ''}${f.zoho_error ? `<p class="g-aviso">${esc(f.zoho_error)}</p>` : ''}
    ${abonos.map(a => `<p class="nota mcb-abono">${ico('volver')} <strong>${esc(a.numero_serie ?? 'Abono')}</strong> −${euros(a.importe)} · ${esc(a.motivo)}${a.zoho_creditnote_number ? ` · Zoho ${esc(a.zoho_creditnote_number)}` : ''}${a.stripe_balance_txn_id ? ' · saldo aplicado' : ''}${a.zoho_error || a.stripe_error ? ` <span class="g-mal">${esc(a.zoho_error || a.stripe_error || '')}</span>` : ''}</p>`).join('')}
    ${(f.estado === 'pagada' && !f.zoho_invoice_id) || (f.zoho_invoice_id && abonable > 0.005) ? `<div class="acciones">
      ${f.estado === 'pagada' && !f.zoho_invoice_id ? `<button class="btn secundario" data-action="mcbEmitir" data-p0="${esc(f.id)}"${dis()}>↻ Emitir en Zoho</button>` : ''}
      ${f.zoho_invoice_id && abonable > 0.005 && _escribe ? `<a class="btn secundario" href="#/mantenimientos/cobros/abonar/${esc(f.id)}">${ico('volver')} Abonar</a>` : ''}</div>` : ''}`;
}

// El enlace de pago no se copia solo: se enseña con WhatsApp y correo, que es como se le manda.
function panelEnlace(): string {
  if (!_enlace) return '';
  const { url, sede, caduca } = _enlace;
  const msg = `Hola${sede?.cliente_nombre ? ` ${sede.cliente_nombre}` : ''}, para pagar la cuota de mantenimiento de OK Computer Tenerife (con tarjeta o domiciliándola por SEPA) solo tienes que entrar en este enlace seguro: ${url}`;
  return `<section class="tarjeta" id="mcb-enlace"><h3>Enlace de pago</h3>
    <label>Enlace <input id="mcb-url" readonly value="${esc(url)}"></label>
    <div class="acciones"><button class="btn secundario" data-action="mcbCopiar">${ico('lista')} Copiar</button>
      <a class="btn secundario" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ico('mensaje')} WhatsApp</a>
      <a class="btn secundario" href="mailto:${encodeURIComponent(sede?.cliente_email ?? '')}?subject=${encodeURIComponent('Pago de la cuota de mantenimiento · OK Computer Tenerife')}&body=${encodeURIComponent(msg)}">${ico('correo')} Correo</a>
      <button class="btn secundario" data-action="mcbCerrarEnlace">Cerrar</button></div>
    <p class="nota">${caduca ? `El enlace caduca el ${esc(fechaCorta(caduca))}.` : 'Es de un solo uso y dura 24 horas.'} Si caduca, genera otro desde aquí.</p></section>`;
}

function panelZoho(): string {
  const z = _zoho;
  if (!z) return '';
  return `<section class="tarjeta" id="mcb-zoho"><h3>Zoho Billing · ${esc(z.sede)}</h3>
    ${z.no_existe ? `<p class="g-aviso">${esc(z.mensaje ?? 'Esa suscripción ya no existe en Zoho Billing.')}</p>` : `<dl class="me-datos mcb-datos">
      <div><dt>Estado en Zoho</dt><dd>${esc(z.status || '—')}</dd></div><div><dt>Estado de pago</dt><dd>${esc(z.estado_pago || '—')}</dd></div>
      <div><dt>Debe</dt><dd>${z.deuda != null ? `${euros(z.deuda)}${z.facturas_impagadas ? ` (${z.facturas_impagadas} facturas)` : ''}` : `<span class="nota">sin consultar${z.deuda_error ? `: ${esc(z.deuda_error)}` : ''}</span>`}</dd></div>
      <div><dt>Cuota (con impuesto)</dt><dd>${euros(z.importe)}</dd></div><div><dt>Próxima cuota</dt><dd>${esc(fechaCorta(z.proxima_cuota)) || '—'}</dd></div></dl>
      ${z.url ? `<p><a href="${esc(z.url)}" target="_blank" rel="noopener">${ico('externo')} Abrir en Zoho Billing</a></p>` : ''}`}
    <p class="nota">${z.guardado ? 'Guardado en la sede.' : 'Solo consultado: hasta el cambio, la sede la actualiza la app cada noche.'}</p>
    <button class="btn secundario" data-action="mcbCerrarZoho">Cerrar</button></section>`;
}

function panelDivergentes(): string {
  if (!_divergentes.length) return '';
  return `<section class="aviso" id="mcb-divergentes"><strong>${_divergentes.length} sede(s) tenían en la app una cuota distinta de la que cobra Stripe.</strong> Se ha guardado la de Stripe, que es la que se cobra; si la buena es la otra, cámbiala con «Cambiar plan».
    <ul>${_divergentes.map(d => `<li><strong>${esc(d.sede)}</strong>: decía ${euros(d.app)}/mes y Stripe cobra ${euros(d.stripe)}/mes</li>`).join('')}</ul>
    <button class="btn secundario" data-action="mcbCerrarDivergentes">Entendido</button></section>`;
}

// ── La sede (el panel «Mant.» de la ficha del sitio de la app) ──────────────
function pintarSede(el: HTMLElement, id: string) {
  const c = _cobros.find(x => x.local_id === id);
  if (!c) { el.innerHTML = `${navPestanas('cobros')}<p class="aviso">Esta sede no está en el cuadro de cobros (puede que esté de baja).</p>`; return; }
  const neto = netoSede(c), meses = mesesDe(c.frecuencia_pago);
  const dato = (t: string, v: string) => `<div><dt>${t}</dt><dd>${v}</dd></div>`;
  el.innerHTML = `${_escribe ? '' : avisoSoloLectura('El cobro de las cuotas')}${navPestanas('cobros')}
    <p><a href="#/mantenimientos/cobros">← Cobros</a> · <a href="#/sitios/${esc(c.local_id)}">Ficha del sitio</a></p>
    <h2>${esc(c.cliente_nombre || '—')} · ${esc(c.local_nombre || '—')}</h2>
    ${panelEnlace()}${panelZoho()}
    <section class="tarjeta" id="mcb-sede"><p class="mdo-cab">${deudaPlan(c) ? chipsSede(c) : chip('Sin mantenimiento')}</p>
      <dl class="me-datos mcb-datos">${dato('Cuota', neto ? `${euros(neto)}/mes <small class="nota">${_cfg?.precio_incluye_impuesto ? 'con impuestos' : 'sin impuestos'}</small><br><small class="nota">Se le cargan ${euros(conImpuesto(neto * meses))} ${cada(c.frecuencia_pago)}</small>${c.importe_incluye_impuesto ? `<br><small class="g-aviso">Heredado de Zoho (${euros(c.importe_mantenimiento)} con impuesto)</small>` : ''}` : '—')}
        ${dato('Frecuencia', esc(normalizaFrecuencia(c.frecuencia_pago) ?? c.frecuencia_pago ?? '—'))}${dato('Forma de pago', esc(c.forma_pago || '—'))}${dato('Estado de pago', esc(c.estado_pago || '—'))}
        ${dato('Próxima cuota', c.proxima_cuota && esStripe(c) ? esc(fechaCorta(c.proxima_cuota)) : '—')}</dl>
      ${c.stripe_ultimo_error ? `<p class="g-mal">${ico('atencion')} ${esc(c.stripe_ultimo_error)}</p>` : ''}
      ${c.stripe_sync_at ? `<p class="nota">Estado traído de Stripe el ${esc(fechaCorta(c.stripe_sync_at))}.</p>` : ''}
      <div class="acciones">${deudaPlan(c) || !sinCobro(c) ? botonesSede(c) : ''}${esStripe(c) ? `<button class="btn secundario" data-action="mcbSync" data-p0="${esc(c.local_id)}"${dis()}>↻ Traer estado de Stripe</button>` : ''}</div></section>
    <section class="tarjeta"><h3>Cuotas</h3>${_facturas.length ? `<ul class="mdo-lista" id="mcb-libro">${_facturas.map(f => `<li data-factura="${esc(f.id)}">${f.numero_serie ? `<strong>${esc(f.numero_serie)}</strong>` : ''}${filaFactura(f)}</li>`).join('')}</ul>`
      : '<p class="vacio">Todavía no hay cuotas para esta sede.</p>'}</section>`;
}

// ── Cambiar plan / importe / frecuencia ─────────────────────────────────────
async function pintarCambiar(el: HTMLElement, id: string) {
  await cargar(id);
  const c = _cobros.find(x => x.local_id === id);
  if (!c) { el.innerHTML = '<p class="aviso">Sede no encontrada.</p>'; return; }
  const planes = (await planesActivos()).filter(p => p.nombre !== 'Sin mantenimiento' && (p.activo || p.nombre === c.plan));
  const frec = normalizaFrecuencia(c.frecuencia_pago) ?? 'Mensual';
  el.innerHTML = `${_escribe ? '' : avisoSoloLectura('El cobro de las cuotas')}<p><a href="#/mantenimientos/cobros/sede/${esc(id)}">← La sede</a></p>
    <h2>Cambiar plan · ${esc(c.cliente_nombre || '')} · ${esc(c.local_nombre || '')}</h2>
    <form class="tarjeta" id="mcc-form" data-on-submit="mccGuardar" data-prevent="1"><input type="hidden" id="mcc-local" value="${esc(id)}">
      <div class="in-campos"><label>Plan <select id="mcc-plan" data-on-change="mccPlan">${planes.map(p => `<option ${p.nombre === c.plan ? 'selected' : ''} data-precio="${p.precio_mensual ?? ''}">${esc(p.nombre)}</option>`).join('') || `<option>${esc(c.plan ?? '')}</option>`}</select></label>
        <label>Cuota €/mes (sin impuestos) <input id="mcc-importe" type="number" step="0.01" min="0" value="${netoSede(c) || ''}" data-on-input="mccBruto"></label>
        <label>Frecuencia <select id="mcc-frecuencia" data-on-change="mccBruto">${FRECUENCIAS.map(([f]) => `<option ${f === frec ? 'selected' : ''}>${f}</option>`).join('')}</select></label></div>
      <p class="nota" id="mcc-bruto" aria-live="polite"></p>
      <p class="nota">Entra en la cuota SIGUIENTE y no se prorratea. Lo cobrado de más en una cuota ya emitida se corrige con un abono.</p>
      <div class="acciones"><button class="btn" type="submit"${dis()}>Cambiar la cuota</button><a class="btn secundario" href="#/mantenimientos/cobros/sede/${esc(id)}">Cancelar</a></div></form>`;
  refrescaBruto();
}

function refrescaBruto() {
  const nota = document.getElementById('mcc-bruto'); if (!nota) return;
  const neto = Number((document.getElementById('mcc-importe') as HTMLInputElement).value.replace(',', '.'));
  const frec = (document.getElementById('mcc-frecuencia') as HTMLSelectElement).value, meses = mesesDe(frec);
  nota.textContent = neto > 0 ? `Se le cargarán ${euros(conImpuesto(neto * meses))} ${cada(frec)}${meses > 1 ? ` — ${euros(neto)}/mes × ${meses} meses` : ''}, a partir de la próxima cuota.` : '';
}

// ── Abonar una cuota ────────────────────────────────────────────────────────
async function pintarAbonar(el: HTMLElement, id: string) {
  const [{ data: f }, { data: ab }, cfg] = await Promise.all([
    API.single<Factura>('mant_facturas', { select: '*', id: `eq.${id}` }), API.get<Abono[]>('mant_abonos', { select: '*', factura_id: `eq.${id}` }),
    API.single<Config>('mant_config', { select: '*', id: 'eq.true' }),
  ]);
  _cfg = cfg.data ?? _cfg;
  if (!f) { el.innerHTML = '<p class="aviso">Cuota no encontrada.</p>'; return; }
  const abonado = (ab ?? []).reduce((s, a) => s + Number(a.importe || 0), 0);
  const abonable = Math.round((Number(f.importe || 0) - abonado) * 100) / 100;
  el.innerHTML = `${_escribe ? '' : avisoSoloLectura('El cobro de las cuotas')}<p><a href="${f.local_id ? `#/mantenimientos/cobros/sede/${esc(f.local_id)}` : '#/mantenimientos/cobros'}">← Volver</a></p>
    <h2>Abonar la cuota ${esc(f.numero_serie ?? '')}</h2>
    <form class="tarjeta" id="mab-form" data-on-submit="mabGuardar" data-prevent="1"><input type="hidden" id="mab-factura" value="${esc(f.id)}">
      <p>Cuota de ${euros(f.importe)}${abonado ? `; ya abonado ${euros(abonado)}` : ''}. Se puede abonar hasta <strong id="mab-max">${euros(abonable)}</strong>.</p>
      <p class="nota">Se emite la factura rectificativa en Zoho (serie ABONO-) y el importe le queda al cliente como <strong>saldo a favor</strong>: se descuenta solo de la cuota siguiente. No se le devuelve dinero al banco.</p>
      ${f.zoho_invoice_id ? '' : '<p class="aviso">Esa cuota todavía no está facturada en Zoho: no hay nada que rectificar. Emítela primero.</p>'}
      <div class="in-campos"><label>Importe a abonar (con impuestos) <input id="mab-importe" type="number" step="0.01" min="0.01" max="${abonable}" required></label>
        <label>Motivo <input id="mab-motivo" required placeholder="«Cambio de plan Silver → Premium», «Impuesto aplicado dos veces»…"></label></div>
      <div class="acciones"><button class="btn peligro" type="submit"${_escribe && f.zoho_invoice_id && abonable > 0.005 ? '' : ' disabled'}>Emitir el abono</button></div></form>`;
}

// ── Ajustes de facturación ──────────────────────────────────────────────────
async function pintarAjustes(el: HTMLElement) {
  const { data: c } = await API.single<Config>('mant_config', { select: '*', id: 'eq.true' });
  _cfg = c ?? null;
  const v = c ?? { serie_prefijo: 'MANT', serie_digitos: 4, precio_incluye_impuesto: false, facturar_automatico: true, enviar_factura_email: true, zoho_notas: null, pago_metodos: ['card', 'sepa'], zoho_tax_id: null, zoho_cuenta_cobro_id: null, zoho_tax_percent: null };
  const met = (v.pago_metodos ?? []).length === 1 ? v.pago_metodos![0] : 'ambos';
  const si = (id: string, val: boolean, t: string, f: string) => `<select id="${id}"><option value="true" ${val ? 'selected' : ''}>${t}</option><option value="false" ${val ? '' : 'selected'}>${f}</option></select>`;
  el.innerHTML = `${_escribe ? '' : avisoSoloLectura('Los ajustes de facturación')}<p><a href="#/mantenimientos/cobros">← Cobros</a></p><h2>Ajustes de facturación</h2>
    <form class="tarjeta" id="mcfg-form" data-on-submit="mcfgGuardar" data-prevent="1">
      <div class="in-campos"><label>Prefijo de la serie <input id="mcfg-prefijo" value="${esc(v.serie_prefijo ?? 'MANT')}" data-on-input="mcfgEjemplo"></label>
        <label>Cifras del número <input id="mcfg-digitos" type="number" min="3" max="8" value="${v.serie_digitos ?? 4}" data-on-input="mcfgEjemplo"></label></div>
      <p class="nota" id="mcfg-ejemplo"></p>
      <div class="in-campos"><label>Los precios de los planes ${si('mcfg-incluye', !!v.precio_incluye_impuesto, 'ya llevan el impuesto', 'son netos (se suma el impuesto)')}</label>
        <label>Factura en Zoho ${si('mcfg-auto', v.facturar_automatico !== false, 'automática al cobrar', 'a mano desde aquí')}</label>
        <label>Mandar la factura al cliente ${si('mcfg-email', v.enviar_factura_email !== false, 'sí, por correo desde Zoho', 'no')}</label></div>
      <div class="in-campos"><label>Impuesto en Zoho <select id="mcfg-tax"><option value="${esc(v.zoho_tax_id ?? '')}">${v.zoho_tax_id ? `${esc(v.zoho_tax_id)}${v.zoho_tax_percent != null ? ` (${v.zoho_tax_percent} %)` : ''}` : '— Sin impuesto —'}</option></select></label>
        <label>Cuenta donde entra el cobro <select id="mcfg-cuenta"><option value="${esc(v.zoho_cuenta_cobro_id ?? '')}">${esc(v.zoho_cuenta_cobro_id ?? '— Sin registrar el cobro —')}</option></select></label>
        <label>Métodos de pago <select id="mcfg-metodos">${[['ambos', 'Tarjeta y SEPA'], ['card', 'Solo tarjeta'], ['sepa', 'Solo SEPA']].map(([k, t]) => `<option value="${k}" ${k === met ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <label>Notas en la factura <textarea id="mcfg-notas" rows="2">${esc(v.zoho_notas ?? '')}</textarea></label>
      <p class="nota" id="mcfg-zoho" aria-live="polite">${_escribe ? 'Consultando los impuestos y cuentas de Zoho…' : ''}</p>
      <div class="acciones"><button class="btn" type="submit"${dis()}>Guardar los ajustes</button></div></form>`;
  ejemploSerie();
  if (!_escribe) return;
  // Los desplegables se traen de Zoho: copiar ids a mano es donde se cuela un error.
  const r = await llamarFuncion<{ impuestos: { id: string; nombre: string; porcentaje: number }[]; cuentas: { id: string; nombre: string }[] }>('stripe-suscripcion', { accion: 'zoho_opciones' });
  const nota = document.getElementById('mcfg-zoho'); if (!nota) return;
  if (r.error || !r.data) { nota.textContent = `No se pudo consultar Zoho: ${r.error}`; return; }
  const tax = document.getElementById('mcfg-tax') as HTMLSelectElement, cta = document.getElementById('mcfg-cuenta') as HTMLSelectElement;
  tax.innerHTML = `<option value="">— Sin impuesto —</option>${r.data.impuestos.map(t => `<option value="${esc(t.id)}" ${t.id === v.zoho_tax_id ? 'selected' : ''}>${esc(t.nombre)} (${esc(String(t.porcentaje))} %)</option>`).join('')}`;
  cta.innerHTML = `<option value="">— Sin registrar el cobro —</option>${r.data.cuentas.map(a => `<option value="${esc(a.id)}" ${a.id === v.zoho_cuenta_cobro_id ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}`;
  nota.textContent = '';
}

function ejemploSerie() {
  const p = (document.getElementById('mcfg-prefijo') as HTMLInputElement | null)?.value.trim().toUpperCase() || 'MANT';
  const d = Number((document.getElementById('mcfg-digitos') as HTMLInputElement | null)?.value) || 4;
  const e = document.getElementById('mcfg-ejemplo'); if (e) e.textContent = `Próxima factura: ${p}-${new Date().getFullYear()}-${'1'.padStart(d, '0')}`;
}

// ── Acciones ────────────────────────────────────────────────────────────────
// Toda acción va a la función; su mensaje sale en el aviso, y tras ella se repinta.
async function fn<T = Record<string, any>>(accion: string, params: Record<string, unknown>, ok = 'Hecho'): Promise<T | null> {
  const r = await llamarFuncion<T & { mensaje?: string }>('stripe-suscripcion', { accion, ...params });
  if (r.error || !r.data) { toast(r.error ?? 'Error', 'error'); return null; }
  toast(r.data.mensaje ?? ok);
  olvidarMantenimientos();
  return r.data;
}
const sede = (id: string) => _cobros.find(c => c.local_id === id) ?? null;

registrarAcciones({
  mcbFiltro(k: string) { _filtro = k; resolver(); },
  mcbBuscar(v: string) {
    _q = v; clearTimeout(_timer);
    _timer = window.setTimeout(() => { resolver(); window.setTimeout(() => { const f = document.getElementById('mcb-q') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(v.length, v.length); }, 60); }, 200);
  },
  async mcbSync(localId?: string) {
    const r = await fn<{ divergentes?: { sede: string; app: number; stripe: number }[] }>('sincronizar', localId ? { local_id: localId } : {}, 'Estado de Stripe sincronizado');
    if (r) { _divergentes = r.divergentes ?? []; resolver(); }
  },
  async mcbMandato(id: string) {
    const c = sede(id);
    if (c?.stripe_mandato_estado === 'activo' && !confirm('Se generará un enlace para que el cliente meta otra tarjeta u otro IBAN. Pasa a ser su medio de pago en cuanto lo confirme; hasta entonces se sigue cobrando con el actual.')) return;
    const r = await fn<{ url?: string; caduca?: string }>('mandato_link', { local_id: id }, 'Enlace generado');
    if (r?.url) { _enlace = { url: r.url, sede: c, caduca: r.caduca ?? null }; resolver(); }
  },
  async mcbPortal(id: string) {
    const r = await fn<{ url?: string }>('portal', { local_id: id }, 'Portal abierto');
    if (r?.url) { const w = window.open(r.url, '_blank'); if (w) w.opener = null; }
  },
  async mcbPausar(id: string) {
    if (!confirm('¿Pausar el cobro de esta sede? Stripe dejará de pasar el recibo hasta que lo reanudes.')) return;
    if (await fn('pausar', { local_id: id })) resolver();
  },
  async mcbReanudar(id: string) { if (await fn('reanudar', { local_id: id })) resolver(); },
  async mcbCancelar(id: string) {
    if (!confirm(`¿Dar de baja la cuota de «${sede(id)?.local_nombre ?? ''}» en Stripe? Se cancelará al final del periodo ya pagado.`)) return;
    if (await fn('cancelar', { local_id: id })) resolver();
  },
  // Alta: se confirma el importe antes de crear nada, porque a partir de ahí se cobra dinero.
  async mcbCrear(id: string) {
    const c = sede(id); if (!c) return;
    if (!c.importe_mantenimiento) { toast('La sede no tiene importe de cuota. Ponlo con «+ Contrato» antes de domiciliar.', 'error'); return; }
    const meses = mesesDe(c.frecuencia_pago), neto = netoSede(c), bruto = conImpuesto(neto * meses);
    if (!confirm(`Se cobrarán ${euros(neto * meses)} + impuestos = ${euros(bruto)} ${cada(c.frecuencia_pago)}${meses > 1 ? ` (${euros(neto)}/mes × ${meses} meses)` : ''} a «${c.local_nombre}» (${c.plan}). `
      + 'El cliente recibirá un enlace para pagar con tarjeta o domiciliar por SEPA; si ya dejó un medio de pago con otra sede suya, la primera cuota se cobra sola.'
      + (c.importe_incluye_impuesto ? `\n\nOJO: esta sede viene de Zoho Billing y su importe guardado (${euros(c.importe_mantenimiento)}) lleva el impuesto dentro. Se cobra sobre ${euros(neto)} netos.` : ''))) return;
    const r = await fn<{ pago_url?: string; mandato_url?: string; caduca?: string }>('crear', { local_id: id });
    if (!r) return;
    const url = r.pago_url || r.mandato_url;
    if (url) _enlace = { url, sede: c, caduca: r.caduca ?? null };
    resolver();
  },
  // Corta el enlace con la suscripción vieja de Zoho. NO da de baja nada allí y la deuda se queda.
  async mcbDesvincular(id: string) {
    const c = sede(id); if (!c?.zoho_subscription_id) return;
    if (!confirm(`La sede «${c.local_nombre}» quedará suelta de la suscripción ${c.zoho_subscription_id} de Zoho Billing y se podrá domiciliar en Stripe. Esto NO da de baja nada en Zoho: hazlo allí primero, o se le cobrarán dos cuotas.`
      + (Number(c.zoho_deuda) > 0 ? ` OJO: tiene apuntada una deuda de ${euros(c.zoho_deuda)} en Zoho, que habrá que reclamar desde Zoho Books.` : ''))) return;
    const r = await API.patch('locales', { id: `eq.${id}` }, { zoho_subscription_id: null, zoho_estado: null, zoho_sync_error: null });
    if (r.error) { toast(`No se pudo desvincular: ${r.error.message}`, 'error'); return; }
    toast('Sede desvinculada de Zoho. Ya se puede domiciliar'); olvidarMantenimientos(); resolver();
  },
  async mcbComprobarZoho(id: string) {
    const c = sede(id); if (!c) return;
    const r = await llamarFuncion<ZohoComprobado>('zoho-cartera', { accion: 'comprobar', local_id: id });
    if (r.error || !r.data) { toast(r.error ?? 'Zoho no contestó', 'error'); return; }
    _zoho = { ...r.data, local: id, sede: [c.cliente_nombre, c.local_nombre].filter(Boolean).join(' · ') };
    if (r.data.guardado) olvidarMantenimientos();
    resolver();
  },
  mcbCerrarZoho() { _zoho = null; resolver(); },
  async mcbEmitir(facturaId: string) { if (await fn('emitir_zoho', { factura_id: facturaId })) resolver(); },
  async mcbCopiar() {
    try { await navigator.clipboard.writeText(_enlace?.url ?? ''); toast('Enlace copiado'); }
    catch { (document.getElementById('mcb-url') as HTMLInputElement | null)?.select(); toast('Cópialo a mano (está seleccionado)', 'error'); }
  },
  mcbCerrarEnlace() { _enlace = null; resolver(); },
  mcbCerrarDivergentes() { _divergentes = []; resolver(); },
  // Al elegir plan se sugiere su precio, pero se deja editable (lo pactado es la norma).
  mccPlan() {
    const o = (document.getElementById('mcc-plan') as HTMLSelectElement).selectedOptions[0];
    if (o?.dataset.precio) (document.getElementById('mcc-importe') as HTMLInputElement).value = o.dataset.precio;
    refrescaBruto();
  },
  mccBruto() { refrescaBruto(); },
  async mccGuardar() {
    const id = (document.getElementById('mcc-local') as HTMLInputElement).value;
    const importe = Number((document.getElementById('mcc-importe') as HTMLInputElement).value.replace(',', '.'));
    if (!importe || importe <= 0) { toast('El importe tiene que ser mayor que cero', 'error'); return; }
    const r = await fn('cambiar', { local_id: id, plan: (document.getElementById('mcc-plan') as HTMLSelectElement).value, importe,
      frecuencia: (document.getElementById('mcc-frecuencia') as HTMLSelectElement).value });
    if (r) ir('mantenimientos', 'cobros', 'sede', id);
  },
  async mabGuardar() {
    const id = (document.getElementById('mab-factura') as HTMLInputElement).value;
    const importe = Number((document.getElementById('mab-importe') as HTMLInputElement).value.replace(',', '.'));
    const motivo = (document.getElementById('mab-motivo') as HTMLInputElement).value.trim();
    if (!importe || importe <= 0) { toast('El importe tiene que ser mayor que cero', 'error'); return; }
    if (!motivo) { toast('Pon el motivo del abono: es lo que explica el documento dentro de seis meses', 'error'); return; }
    if (!confirm(`Se van a abonar ${euros(importe)}: sale un documento fiscal en Zoho y el saldo a favor en Stripe. ¿Seguir?`)) return;
    const r = await fn<{ aviso?: string | null }>('abonar', { factura_id: id, importe, motivo });
    if (!r) return;
    if (r.aviso) toast(r.aviso, 'error');
    const { data: f } = await API.single<{ local_id: string | null }>('mant_facturas', { select: 'local_id', id: `eq.${id}` });
    if (f?.local_id) ir('mantenimientos', 'cobros', 'sede', f.local_id); else ir('mantenimientos', 'cobros');
  },
  mcfgEjemplo() { ejemploSerie(); },
  async mcfgGuardar() {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    const taxId = val('mcfg-tax') || null;
    const met = val('mcfg-metodos');
    // Si cambia el impuesto se suelta el % guardado (si no, la base se calcularía con el viejo).
    const r = await API.patch('mant_config', { id: 'eq.true' }, {
      serie_prefijo: val('mcfg-prefijo').trim().toUpperCase() || 'MANT', serie_digitos: Number(val('mcfg-digitos')) || 4,
      precio_incluye_impuesto: val('mcfg-incluye') === 'true', facturar_automatico: val('mcfg-auto') === 'true', enviar_factura_email: val('mcfg-email') === 'true',
      zoho_tax_id: taxId, zoho_tax_percent: taxId === (_cfg?.zoho_tax_id ?? null) ? (_cfg?.zoho_tax_percent ?? null) : null,
      zoho_cuenta_cobro_id: val('mcfg-cuenta') || null, zoho_notas: val('mcfg-notas').trim() || null,
      pago_metodos: met === 'ambos' ? ['card', 'sepa'] : [met], updated_at: new Date().toISOString(),
    });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    toast('Ajustes guardados'); ir('mantenimientos', 'cobros');
  },
});
