// Vista de Mantenimientos (ver index.ts). Solo lectura.
//
// Reglas que vienen de la app (`public/js/modules/mant-estados.js`) y que hay
// que tocar a la vez si allí cambian:
//   · A una sede la cobra Stripe si tiene suscripción; la Zoho Billing vieja si
//     tiene `zoho_subscription_id`, NO tiene Stripe y su estado no está muerto
//     (`sedeEnZoho`). Con Stripe y sin mandato activo, falta el primer pago.
//   · `importe_mantenimiento` es NETO y mensual, salvo la cartera heredada de
//     Zoho (`importe_incluye_impuesto`), que lo guarda en BRUTO: se le quita el
//     IGIC para sumarlo (`netoSede`). El 7 % es el tipo general de Canarias,
//     el mismo por defecto de la facturación del hub; `mant_config` no se copia.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { avisoSoloLectura } from '../../core/areas';
import { esc } from '../../ui/dom';
import { barras } from '../../ui/barras';
import { eur, enApp } from '../ventas/datos';

interface Sede {
  id: string; nombre: string; cliente_id: string | null; plan: string | null; estado_pago: string | null;
  frecuencia_pago: string | null; forma_pago: string | null; proxima_cuota: string | null; fecha_activacion: string | null;
  zoho_subscription_id: string | null; zoho_estado: string | null; stripe_subscription_id: string | null; stripe_mandato_estado: string | null;
  stripe_cobro_en_curso_at: string | null; stripe_ultimo_error: string | null;
  importe_mantenimiento?: number | null; importe_incluye_impuesto?: boolean | null; zoho_deuda?: number | null;
}
type Pasarela = 'stripe' | 'espera' | 'zoho' | 'nadie';

const IGIC = 7;
const ZOHO_MUERTA = new Set(['cancelled', 'expired', 'cancelled_from_dunning', 'no_existe']);
const PAGO_MAL = ['Último aviso', 'No paga'];
const TORCIDO = ['Pendiente de pago', ...PAGO_MAL];
const PASARELA: Record<Pasarela, [string, string]> = {
  stripe: ['Stripe', 'bien'], espera: ['Esperando el primer pago', 'aviso'], zoho: ['Zoho (cartera vieja)', ''], nadie: ['Sin domiciliar', 'aviso'],
};
const FILTROS: [string, string][] = [['', 'Todas'], ['torcido', 'Cobro torcido'], ['en_curso', 'Cobro en curso'], ['nadie', 'Sin domiciliar'],
  ['espera', 'Esperando pago'], ['stripe', 'Stripe'], ['zoho', 'Zoho']];

let _lista: Sede[] = [];
let _listaAt = 0;
let _clientes = new Map<string, string>();
let _q = '';
let _filtro = '';
let _plan = '';

const enZoho = (s: Sede) => !!s.zoho_subscription_id && !s.stripe_subscription_id && !ZOHO_MUERTA.has((s.zoho_estado ?? '').toLowerCase());
export const pasarela = (s: Sede): Pasarela => s.stripe_subscription_id ? (s.stripe_mandato_estado === 'activo' ? 'stripe' : 'espera') : enZoho(s) ? 'zoho' : 'nadie';
export function netoMensual(s: Sede): number {
  const g = Number(s.importe_mantenimiento ?? 0);
  return !g || !s.importe_incluye_impuesto ? g : Math.round(g / (1 + IGIC / 100) * 100) / 100;
}
const diasEnCurso = (s: Sede) => s.stripe_cobro_en_curso_at ? Math.floor((Date.now() - Date.parse(s.stripe_cobro_en_curso_at)) / 86_400_000) : -1;
const chipPago = (s: Sede) => `${s.estado_pago && s.estado_pago !== 'Al corriente'
  ? `<span class="chip ${PAGO_MAL.includes(s.estado_pago) ? 'mal' : 'aviso'}">${esc(s.estado_pago)}</span>` : `<span class="chip bien">${esc(s.estado_pago ?? 'Al corriente')}</span>`}${
  s.stripe_cobro_en_curso_at ? ` <span class="chip ${diasEnCurso(s) >= 10 ? 'aviso' : ''}" title="SEPA tarda unos 6 días hábiles en liquidar">Cobro en curso · ${diasEnCurso(s)} d</span>` : ''}${
  s.stripe_ultimo_error ? ` <span class="chip mal" title="${esc(s.stripe_ultimo_error)}">Error de Stripe</span>` : ''}`;
const fechaCorta = (f: string | null) => f ? esc(new Date(`${f.slice(0, 10)}T12:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })) : '';

async function cargar() {
  if (_lista.length && Date.now() - _listaAt < 5 * 60_000) return null;
  const cols = `id,nombre,cliente_id,plan,estado_pago,frecuencia_pago,forma_pago,proxima_cuota,fecha_activacion,zoho_subscription_id,zoho_estado,stripe_subscription_id,stripe_mandato_estado,stripe_cobro_en_curso_at,stripe_ultimo_error${esAdmin() ? ',importe_mantenimiento,importe_incluye_impuesto,zoho_deuda' : ''}`;
  const [ls, cs] = await Promise.all([
    API.fetchAll<Sede>('locales', { select: cols, plan: 'not.in.("Sin mantenimiento","")', activo: 'neq.false', order: 'nombre' }),
    _clientes.size ? Promise.resolve(null) : API.fetchAll<{ id: string; nombre: string }>('clientes', { select: 'id,nombre' }),
  ]);
  if (cs && !cs.error) _clientes = new Map((cs.data ?? []).map(c => [c.id, c.nombre]));
  if (ls.error) return ls.error;
  _lista = ls.data ?? []; _listaAt = Date.now();
  return null;
}

function filtradas(): Sede[] {
  const q = _q.toLowerCase();
  return _lista.filter(s => {
    if (_filtro === 'torcido' && !TORCIDO.includes(s.estado_pago ?? '') && !s.stripe_ultimo_error) return false;
    if (_filtro === 'en_curso' && !s.stripe_cobro_en_curso_at) return false;
    if (['nadie', 'espera', 'stripe', 'zoho'].includes(_filtro) && pasarela(s) !== _filtro) return false;
    if (_plan && s.plan !== _plan) return false;
    return !q || [s.nombre, s.plan, _clientes.get(s.cliente_id ?? '')].some(x => (x ?? '').toLowerCase().includes(q));
  });
}

function cifra(titulo: string, valor: string, sub: string, tono = '') {
  return `<article class="tarjeta di-cifra ${tono}"><h3>${esc(titulo)}</h3><p class="di-valor">${valor}</p><p class="nota">${sub}</p></article>`;
}

function cabeza(): string {
  const torcidas = _lista.filter(s => TORCIDO.includes(s.estado_pago ?? '') || !!s.stripe_ultimo_error);
  const sinCobrar = _lista.filter(s => pasarela(s) === 'nadie' || pasarela(s) === 'espera');
  const admin = esAdmin();
  const mes = _lista.reduce((t, s) => t + netoMensual(s), 0);
  const deuda = _lista.reduce((t, s) => t + Number(s.zoho_deuda ?? 0), 0);
  const porPlan = new Map<string, Sede[]>();
  for (const s of _lista) porPlan.set(s.plan ?? '—', [...(porPlan.get(s.plan ?? '—') ?? []), s]);
  const planes = [...porPlan.entries()].sort((a, b) => b[1].length - a[1].length);
  // Admin: cuota neta al mes por plan (lo que deja cada plan); el resto, sedes por plan.
  const filas = planes.map(([p, ss]) => {
    const neto = ss.reduce((t, s) => t + netoMensual(s), 0);
    return admin
      ? { clave: p, etiqueta: p, valor: neto, texto: `${eur(neto)} <small class="nota">· ${ss.length}</small>`, detalle: `${p}: ${ss.length} sedes · ${eur(neto, 2)} al mes sin impuestos` }
      : { clave: p, etiqueta: p, valor: ss.length, texto: String(ss.length), detalle: `${p}: ${ss.length} sedes` };
  });
  return `<div class="pp-cabeza">
    <div class="di-cifras pp-cifras">
      ${cifra('Sedes con mantenimiento', String(_lista.length), `${planes.length} ${planes.length === 1 ? 'plan' : 'planes'}`)}
      ${admin ? cifra('Al mes, sin impuestos', eur(mes), `${eur(mes * 12)} al año`) : cifra('Cobra Stripe', String(_lista.filter(s => pasarela(s) === 'stripe').length), 'sedes domiciliadas')}
      ${cifra('Cobro torcido', String(torcidas.length), torcidas.length ? 'pendiente, último aviso, no paga o error de Stripe' : 'todas al corriente', torcidas.length ? 'mal' : '')}
      ${cifra('Sin cobrar todavía', String(sinCobrar.length), admin && deuda ? `sin domiciliar o esperando el primer pago · deuda Zoho ${eur(deuda)}` : 'sin domiciliar o esperando el primer pago', sinCobrar.length ? 'atento' : '')}
    </div>
    ${barras('mt-barras', admin ? 'Cuota mensual por plan' : 'Sedes por plan', filas, 'mtPlanBarra')}
  </div>`;
}

export async function pintarMantenimientos(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const error = await cargar();
  if (error && !_lista.length) { el.innerHTML = `<p class="aviso mal">No se pudieron leer las sedes: ${esc(error.message)}</p>`; return; }
  const admin = esAdmin();
  const planes = [...new Set(_lista.map(s => s.plan).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const lista = filtradas();
  el.innerHTML = `${avisoSoloLectura('Mantenimientos')}
    ${cabeza()}
    <div class="acciones mo-barra">
      <input id="mt-filtro" type="search" placeholder="Buscar por sede, cliente o plan…" value="${esc(_q)}" data-on-input="mtFiltrar:$value" aria-label="Buscar sede">
      <select id="mt-plan" data-on-change="mtPlan:$value" aria-label="Plan"><option value="">Todos los planes</option>
        ${planes.map(p => `<option ${p === _plan ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <a class="btn secundario" href="${esc(enApp())}" target="_blank" rel="noopener" title="Altas, cambios de plan, enlaces de pago y contratos">Gestionar en la app ↗</a>
    </div>
    <div class="acciones mo-barra">${FILTROS.map(([k, n]) => `<button class="chip-boton ${_filtro === k ? 'activo' : ''}" data-action="mtFiltro" data-p0="${k}">${n}</button>`).join('')}</div>
    <p class="nota">Mostrando ${Math.min(lista.length, 300)} de ${lista.length}${admin ? ` · ${eur(lista.reduce((t, s) => t + netoMensual(s), 0), 2)} al mes sin impuestos` : ''}.</p>
    <div class="tarjeta mo-scroll"><table class="tabla" id="mt-tabla"><thead><tr><th>Sede</th><th>Plan</th>${admin ? '<th class="num">Cuota/mes</th>' : ''}<th>Quién cobra</th><th>Pago</th><th>Próxima cuota</th></tr></thead>
      <tbody>${lista.slice(0, 300).map(s => {
        const [txt, tono] = PASARELA[pasarela(s)];
        return `<tr class="fila-clic" data-action="mtAbrir" data-p0="${esc(s.id)}">
        <td><strong>${esc(s.nombre)}</strong>${_clientes.get(s.cliente_id ?? '') ? `<br><small class="nota">${esc(_clientes.get(s.cliente_id ?? ''))}</small>` : ''}</td>
        <td>${esc(s.plan ?? '')}${s.frecuencia_pago && s.frecuencia_pago !== 'Mensual' ? ` <small class="nota">${esc(s.frecuencia_pago)}</small>` : ''}</td>
        ${admin ? `<td class="num">${s.importe_mantenimiento ? eur(netoMensual(s), 2) : '—'}${s.importe_incluye_impuesto ? '<br><small class="nota" title="La cartera de Zoho guarda el importe con el IGIC dentro">bruto Zoho</small>' : ''}</td>` : ''}
        <td><span class="chip ${tono}">${esc(txt)}</span></td>
        <td>${chipPago(s)}</td>
        <td>${fechaCorta(s.proxima_cuota)}</td></tr>`;
      }).join('') || `<tr><td colspan="${admin ? 6 : 5}" class="vacio">Ninguna sede con ese filtro.</td></tr>`}</tbody></table></div>`;
}

let _timer: number | undefined;
registrarAcciones({
  mtAbrir(id: string) { ir('sitios', id); },
  mtFiltro(k: string) { _filtro = k; resolver(); },
  mtPlan(v: string) { _plan = v; resolver(); },
  // La barra de un plan filtra por él; pulsarla otra vez lo quita.
  mtPlanBarra(v: string) { _plan = v === _plan ? '' : v; resolver(); },
  mtFiltrar(v: string) {
    _q = v;
    clearTimeout(_timer);
    _timer = window.setTimeout(() => {
      resolver();
      window.setTimeout(() => { const f = document.getElementById('mt-filtro') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(v.length, v.length); }, 60);
    }, 250);
  },
});
