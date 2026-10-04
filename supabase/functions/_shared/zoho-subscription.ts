// Portado de la app (_shared/zoho-subscription.ts, paridad bloque 4, tandas 3
// y 4): la cartera vieja de Zoho Billing, en SOLO LECTURA hacia Zoho. Cambio:
// habla con Zoho por el cliente propio del hub (zoho-ctx.ts); la API de
// Billing pide permisos ZohoSubscriptions.* en el Self Client
// (PENDIENTE_FRAN §5).
// Lógica compartida para sincronizar una suscripción de Zoho Billing
// con los campos de un `local` en Supabase.
//
// La usan tanto `sync-zoho-subscription` (sincronización puntual de un local)
// como `sync-zoho-subscriptions-daily` (refresco diario de todas las
// suscripciones). Mantener el mapeo en un único sitio evita que ambas
// funciones se desincronicen.
//
// OJO con el estado de pago: este mapeo es lo ÚNICO que decide si una sede de
// la cartera vieja sale en verde. Un estado de Zoho que no estuviera en la
// tabla caía en un `|| 'Al corriente'`, así que una suscripción impagada o en
// dunning se pintaba «Al corriente» con facturas vencidas sin cobrar. Ahora
// están los estados que faltaban, el desconocido tira a «Pendiente de pago»
// (nunca a verde) y, además, se mira el SALDO REAL de sus facturas: una
// suscripción puede seguir `live` y arrastrar recibos sin pagar.

import type { ZohoCtx } from './zoho-ctx.ts'

// Zoho status → estado_pago local.
// Los nombres son los de la API de Zoho Billing (Subscriptions); se listan
// TODOS los que documenta, porque el que falte se traduce a verde.
export const STATUS_TO_ESTADO: Record<string, string> = {
  live:                   'Al corriente',
  active:                 'Al corriente',
  trial:                  'Al corriente',
  future:                 'Pendiente de pago',
  unpaid:                 'Pendiente de pago',
  past_due:               'Pendiente de pago',
  trial_expired:          'Pendiente de pago',
  creation_failed:        'Pendiente de pago',
  dunning:                'Último aviso',
  paused:                 'Pausada',
  non_renewing:           'Baja solicitada',
  cancelled:              'Baja solicitada',
  expired:                'Baja solicitada',
  cancelled_from_dunning: 'No paga',
}

// ── ¿La suscripción de Zoho sigue cobrando? ────────────────────────────────
// Tener `zoho_subscription_id` NO significa que la sede se esté cobrando: la
// suscripción puede estar dada de baja, caducada o directamente BORRADA en
// Zoho. Mientras se miró sólo si el campo tenía algo, una sede a la que se le
// había dado de baja allí quedaba bloqueada para siempre: «Dala de baja en
// Zoho antes de domiciliarla» cuando ya estaba dada de baja, y sin ningún
// camino para domiciliarla en Stripe.
//
// OJO con `non_renewing`: la baja está pedida pero la suscripción SIGUE
// cobrando hasta que venza el periodo, así que no entra aquí — domiciliarla
// además en Stripe le cobraría dos veces.
export const ZOHO_NO_EXISTE = 'no_existe'
export const ESTADOS_ZOHO_MUERTOS = new Set([
  'cancelled', 'expired', 'cancelled_from_dunning', ZOHO_NO_EXISTE,
])

// Una sede la cobra Stripe o la Zoho Billing vieja, nunca las dos: con
// suscripción de Stripe ya no manda Zoho.
export function zohoSigueCobrando(local: any): boolean {
  if (!local?.zoho_subscription_id) return false
  if (local.stripe_subscription_id) return false
  return !ESTADOS_ZOHO_MUERTOS.has(norm(local.zoho_estado))
}

// Campos con los que se desvincula una sede cuya suscripción ya no existe en
// Zoho. El id se borra a propósito: apunta a algo que Zoho no tiene, y
// mientras siga puesto la sede no se puede domiciliar. La deuda y las facturas
// impagadas NO se tocan: si quedó algo sin cobrar, sigue debiéndose.
export function camposZohoBorrada(): Record<string, unknown> {
  return {
    zoho_subscription_id: null,
    zoho_estado: ZOHO_NO_EXISTE,
    zoho_sync_error: null,
    zoho_sync_at: new Date().toISOString(),
  }
}

// Estado para un `status` que Zoho no tenía documentado cuando se escribió
// esto (retiran y añaden estados). Nunca «Al corriente»: si no se sabe si ha
// pagado, no se puede decir que está al día.
export const ESTADO_DESCONOCIDO = 'Pendiente de pago'

// Avisos que pone una PERSONA cuando ya ha reclamado. Son todos peores que
// «Pendiente de pago», así que el refresco diario no los degrada mientras la
// deuda siga ahí: si no, marcar «Último aviso» por la tarde se borraba solo a
// las 4:00 de la mañana.
const ESTADOS_ESCALADOS = new Set(['en espera de respuesta', 'ultimo aviso', 'no paga'])

const norm = (v: unknown) =>
  (v ?? '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

// Zoho gateway → forma_pago local
export function gatewayToFormaPago(gateway: string, intervalUnit: string): string {
  const gw = (gateway || '').toLowerCase()
  if (gw.includes('stripe')) {
    return intervalUnit === 'years' ? 'Stripe Anual' : 'Stripe Mensual'
  }
  if (gw.includes('gocardless') || gw.includes('mandate') || gw.includes('sepa')) return 'Domiciliación'
  if (gw.includes('paypal')) return 'Transferencia'
  if (gw === '' || gw === 'offline') return 'Transferencia'
  return gateway
}

export function parseZohoDate(val: any): string | null {
  if (!val) return null
  const d = new Date(typeof val === 'number' ? val * 1000 : val)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// Normaliza el nombre del plan al valor esperado por la app.
export function normalizePlanName(raw: string): string {
  const s = (raw || '').toLowerCase()
  if (s.includes('gold') || s.includes('oro'))     return 'Gold'
  if (s.includes('premium'))                        return 'Premium'
  if (s.includes('silver') || s.includes('plata')) return 'Silver'
  if (s.includes('basic') || s.includes('básico') || s.includes('basico')) return 'Basic'
  return raw // conservar el valor original si no hay coincidencia
}

// «Esa suscripción no existe» es una RESPUESTA, no una avería.
// Zoho contesta lo mismo tanto si la suscripción se borró como si el id que
// tenemos apuntado nunca fue suyo, y las dos cosas significan lo mismo para la
// app: por ahí ya no se cobra a nadie. Guardarlo como fallo de sincronización
// dejaba la sede marcada «sin comprobar» para siempre y, peor, seguía
// bloqueando el alta en Stripe.
export class ZohoSubNoExiste extends Error {
  readonly noExiste = true
  constructor(msg: string) { super(msg); this.name = 'ZohoSubNoExiste' }
}

const RE_NO_EXISTE = /no existe|does ?n[o']?t exist|not found|no such|invalid value passed for subscription|no se encontr/i

export function esZohoNoExiste(e: unknown): boolean {
  if (!e) return false
  if ((e as any).noExiste) return true
  return RE_NO_EXISTE.test((e as any)?.message ?? String(e))
}

// Descarga una suscripción concreta desde Zoho Billing.
// Lanza un error si la API responde con código distinto de 0, y un
// `ZohoSubNoExiste` cuando lo que contesta es que esa suscripción ya no está.
// deno-lint-ignore no-explicit-any
export async function fetchZohoSubscription(
  ctx: ZohoCtx, accessToken: string, subscriptionId: string,
): Promise<any> {
  const res = await fetch(
    `https://${ctx.apiDomain}/billing/v1/subscriptions/${subscriptionId}?organization_id=${ctx.ZOHO_ORG_ID}`,
    { headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } },
  )
  const data = await res.json().catch(() => ({}))
  if (data.code !== 0) {
    const msg = `Zoho Billing API Error: ${data.message || JSON.stringify(data)}`
    if (res.status === 404 || RE_NO_EXISTE.test(String(data.message || ''))) {
      throw new ZohoSubNoExiste(msg)
    }
    throw new Error(msg)
  }
  if (!data.subscription) throw new ZohoSubNoExiste('No se encontró la suscripción en Zoho Billing.')
  return data.subscription
}

// ── Deuda: lo que la suscripción debe de verdad ────────────────────────────
// El `status` de la suscripción no basta. Zoho la mantiene `live` mientras
// reintenta o mientras las facturas se emiten en modo offline, así que una
// sede «viva» puede llevar meses sin pagar. Lo que no engaña es el saldo de
// sus facturas.

export interface ZohoDeuda {
  deuda: number        // suma de los saldos pendientes (con impuestos)
  facturas: number     // cuántas facturas lo componen
  comprobado: boolean  // false = no se pudo saber; NO se usa para decidir nada
  error?: string
}

// Facturas que cuentan como deuda. Fuera los borradores (no se han emitido) y
// las anuladas. Se filtra en cliente además de por `filter_by`, para no
// depender de que Zoho interprete el filtro igual en Books y en Billing.
const ESTADOS_IMPAGADA = new Set(['sent', 'overdue', 'unpaid', 'partially_paid', 'viewed', 'pending'])

export async function fetchZohoDeuda(
  ctx: ZohoCtx, accessToken: string, subscriptionId: string, customerId?: string,
): Promise<ZohoDeuda> {
  const vacio = (error?: string): ZohoDeuda => ({ deuda: 0, facturas: 0, comprobado: false, error })
  try {
    const url = `https://${ctx.apiDomain}/billing/v1/invoices`
      + `?organization_id=${ctx.ZOHO_ORG_ID}`
      + `&subscription_id=${encodeURIComponent(subscriptionId)}`
      + `&filter_by=Status.Unpaid&per_page=200`
    const res  = await fetch(url, { headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } })
    const data = await res.json().catch(() => ({}))
    if (data.code !== 0) return vacio(data.message || `HTTP ${res.status}`)

    const invoices: any[] = Array.isArray(data.invoices) ? data.invoices : []

    // Si Zoho hubiera ignorado el filtro `subscription_id`, la lista traería
    // facturas de otras suscripciones y se le colgaría a esta sede una deuda
    // que no es suya. Se comprueba con lo que venga: el propio
    // `subscription_id` de la factura o, si no lo trae, el cliente.
    const deOtro = invoices.some(f =>
      (f.subscription_id && String(f.subscription_id) !== String(subscriptionId)) ||
      (!f.subscription_id && customerId && f.customer_id && String(f.customer_id) !== String(customerId))
    )
    if (deOtro) return vacio('Zoho devolvió facturas de otras suscripciones; no se puede atribuir la deuda.')

    const impagadas = invoices.filter(f =>
      ESTADOS_IMPAGADA.has(String(f.status || '').toLowerCase()) && Number(f.balance || 0) > 0)

    const deuda = impagadas.reduce((s, f) => s + Number(f.balance || 0), 0)
    return { deuda: Math.round(deuda * 100) / 100, facturas: impagadas.length, comprobado: true }
  } catch (e: any) {
    return vacio(e?.message || 'Error consultando las facturas de Zoho Billing')
  }
}

export interface LocalSubscriptionFields {
  plan: string | null
  estado_pago: string
  importe_mantenimiento: number | null
  // Lo que se guarda en `importe_mantenimiento` es `sub.amount`: lo que Zoho
  // COBRA, con el impuesto ya dentro. El resto de la app da por hecho que ese
  // campo es neto, así que hay que dejarlo dicho en cada sincronización — no
  // basta con marcarlo una vez, porque este sync corre cada noche y reescribe
  // el importe. Ver 20260919_importe_bruto_cartera_zoho.sql.
  importe_incluye_impuesto: boolean
  forma_pago: string
  fecha_activacion: string | null
  proxima_cuota: string | null
  zoho_estado: string | null
  zoho_deuda: number | null
  zoho_facturas_impagadas: number | null
}

export interface MapOpts {
  deuda?: ZohoDeuda | null
  // `estado_pago` que tiene ahora la sede en Supabase: sirve para no borrar un
  // aviso puesto a mano mientras la deuda siga viva.
  estadoActual?: string | null
}

// Traduce el estado de Zoho (+ la deuda real) al `estado_pago` de la app.
export function estadoPagoDeZoho(status: string, opts: MapOpts = {}): string {
  const base = STATUS_TO_ESTADO[String(status || '').toLowerCase()] ?? ESTADO_DESCONOCIDO
  const { deuda, estadoActual } = opts

  // Live pero debiendo: lo que ve el cliente es una factura sin pagar.
  let estado = (base === 'Al corriente' && deuda?.comprobado && deuda.deuda > 0)
    ? 'Pendiente de pago'
    : base

  // No degradar el aviso que puso una persona: «Último aviso» o «No paga»
  // dicen más que «Pendiente de pago» y describen la misma situación.
  if (estado === 'Pendiente de pago' && ESTADOS_ESCALADOS.has(norm(estadoActual))) {
    estado = estadoActual as string
  }
  return estado
}

// Traduce una suscripción de Zoho a los campos del `local`.
// `proxima_cuota` = fecha de vencimiento; `estado_pago` = estado.
export function mapSubscriptionToLocalFields(sub: any, opts: MapOpts = {}): LocalSubscriptionFields {
  const status        = sub.status || ''
  const raw_plan_name = sub.plan?.plan_name || sub.plan?.name || sub.plan_name || sub.plan_code || ''
  const plan_name     = raw_plan_name ? normalizePlanName(raw_plan_name) : ''
  const amount        = sub.amount ?? sub.plan?.price ?? null
  const interval_unit = sub.plan?.interval_unit || sub.interval_unit || 'months'
  const gateway       = sub.payment_gateways?.[0]?.gateway_name || ''
  const deuda         = opts.deuda

  return {
    plan:                  plan_name || null,
    estado_pago:           estadoPagoDeZoho(status, opts),
    importe_mantenimiento: amount,
    // `sub.amount` es el cobro, impuesto incluido. Se marca SIEMPRE, no solo
    // cuando hay importe: si Zoho devolviera null, dejar la marca en `true` es
    // el lado seguro (el alta divide un importe que no existe = 0 y avisa, en
    // vez de cobrar un bruto como si fuera neto).
    importe_incluye_impuesto: true,
    forma_pago:            gatewayToFormaPago(gateway, interval_unit),
    fecha_activacion:      parseZohoDate(sub.activated_at || sub.start_date || sub.current_term_starts_at),
    proxima_cuota:         parseZohoDate(sub.next_billing_at),
    zoho_estado:           status || null,
    // Si no se pudo consultar, se deja a NULL en vez de escribir un 0: un cero
    // se lee como «no debe nada» y sería la misma mentira que arreglamos.
    zoho_deuda:            deuda?.comprobado ? deuda.deuda : null,
    zoho_facturas_impagadas: deuda?.comprobado ? deuda.facturas : null,
  }
}
