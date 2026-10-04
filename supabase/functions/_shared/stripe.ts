// Portado de la app (_shared/stripe.ts, paridad bloque 4, tanda 3): igual, con
// el cliente de datos sobre el esquema hub (sb-hub.ts).
// Cliente REST de Stripe compartido por `stripe-suscripcion`, `stripe-webhook`
// y `firma-contrato` (a través de `stripe-cobros.ts`).
//
// Stripe cobra TODO el mantenimiento: la cartera de siempre y las altas nuevas,
// con tarjeta y con domiciliación SEPA, las dos por Stripe Checkout. Es la
// única pasarela: MONEI se probó y se retiró (su domiciliación SEPA, que era el
// motivo de traerlo, no estaba realmente disponible). Ver
// docs/MANTENIMIENTO_STRIPE.md.
//
// Con `fetch` y no con el SDK, por coherencia con el resto de integraciones de
// este repo (Zoho, Google, Groq): una dependencia menos que fijar, y el mismo
// estilo de código en todas las funciones.
//
// La API de Stripe NO acepta JSON: espera `application/x-www-form-urlencoded`
// con los objetos anidados aplanados al estilo `a[b][c]=v` y las listas
// indexadas `items[0][price]=…`. Eso es lo que hace `formEncode`.

export interface StripeCtx {
  secretKey: string
  webhookSecret: string
}

export function stripeCtx(): StripeCtx {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
  if (!secretKey) {
    throw new Error('Falta el secret STRIPE_SECRET_KEY en Supabase (Edge Functions → Secrets).')
  }
  return { secretKey, webhookSecret: Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '' }
}

// Aplana un objeto al formato de Stripe.
//   { items: [{ price: 'p1' }], metadata: { local_id: 'x' } }
//   → items[0][price]=p1&metadata[local_id]=x
// Los `undefined` y `null` se omiten: así se puede construir el payload con
// campos opcionales sin filtrarlos uno a uno en cada llamada.
export function formEncode(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = []
  for (const [rawKey, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    const key = prefix ? `${prefix}[${rawKey}]` : rawKey
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item === undefined || item === null) return
        if (typeof item === 'object') {
          parts.push(formEncode(item as Record<string, unknown>, `${key}[${i}]`))
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)
        }
      })
    } else if (typeof value === 'object') {
      parts.push(formEncode(value as Record<string, unknown>, key))
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
  }
  return parts.filter(Boolean).join('&')
}

export interface StripeRequestOpts {
  // Clave de idempotencia de Stripe: repetir la misma petición con la misma
  // clave devuelve la PRIMERA respuesta en vez de crear un objeto nuevo. Es lo
  // que evita dos suscripciones si el técnico pulsa el botón dos veces.
  idempotencyKey?: string
}

export async function stripeReq<T = any>(
  ctx: StripeCtx,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Record<string, unknown> = {},
  opts: StripeRequestOpts = {},
): Promise<T> {
  const body = method === 'GET' ? '' : formEncode(params)
  const qs   = method === 'GET' ? formEncode(params) : ''
  const url  = `https://api.stripe.com/v1/${path}${qs ? `?${qs}` : ''}`

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${ctx.secretKey}`,
    'Stripe-Version': '2024-06-20',
  }
  if (method !== 'GET') headers['Content-Type'] = 'application/x-www-form-urlencoded'
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey

  const res  = await fetch(url, { method, headers, body: body || undefined })
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    // El mensaje de Stripe es el que hay que enseñar al usuario ("Your bank
    // account could not be verified"), no un 400 genérico.
    const msg = data?.error?.message || `Stripe ${res.status}`
    const err = new Error(`Stripe: ${msg}`) as Error & { stripeCode?: string; stripeType?: string }
    err.stripeCode = data?.error?.code
    err.stripeType = data?.error?.type
    throw err
  }
  return data as T
}

// ── Verificación de la firma del webhook ────────────────────────────────────
// Sin esto, cualquiera que conozca la URL de la función podría inventarse un
// `invoice.paid` y hacernos emitir una factura. La cabecera `Stripe-Signature`
// trae `t=<timestamp>,v1=<hmac>`; el HMAC-SHA256 se calcula sobre
// `<timestamp>.<cuerpo crudo>` con el secret del endpoint.
//
// IMPORTANTE: hay que pasar el cuerpo TAL CUAL llegó (`await req.text()`).
// Un `JSON.parse` + `JSON.stringify` cambia los espacios y la firma no cuadra.
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
  toleranceSeconds = 300,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!webhookSecret) return { ok: false, reason: 'Falta STRIPE_WEBHOOK_SECRET' }
  if (!signatureHeader) return { ok: false, reason: 'Falta la cabecera Stripe-Signature' }

  const parts = Object.fromEntries(
    signatureHeader.split(',').map(p => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  ) as Record<string, string>

  const timestamp = parts['t']
  // Puede venir más de un v1 (durante una rotación de secret): Stripe los
  // separa por comas, así que hay que recogerlos todos, no solo el último.
  const signatures = signatureHeader
    .split(',')
    .map(p => p.split('='))
    .filter(([k]) => k.trim() === 'v1')
    .map(([, v]) => v.trim())

  if (!timestamp || !signatures.length) return { ok: false, reason: 'Firma con formato inesperado' }

  // Ventana de tolerancia: rechaza el replay de un evento antiguo capturado.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isFinite(age) || age > toleranceSeconds) {
    return { ok: false, reason: `Evento fuera de la ventana de tolerancia (${age}s)` }
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`),
  )
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('')

  const match = signatures.some(sig => timingSafeEqual(sig, expected))
  return match ? { ok: true } : { ok: false, reason: 'Firma no válida' }
}

// Comparación en tiempo constante: comparar con `===` filtra por cuánto tarda
// en fallar y deja adivinar la firma byte a byte.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ── Utilidades de importes ──────────────────────────────────────────────────
// La aritmética de la cuota (céntimos, impuestos, base imponible) no depende de
// la pasarela y vive aparte, en `mant-importes.ts`. Se re-exporta para que el
// código de Stripe siga igual.
export {
  aCentimos, aEuros, importeACobrar, precioDesdeCobro, baseImponible, importeNetoDeSede,
} from './mant-importes.ts'
import { normalizaFrecuencia } from './mant-importes.ts'
export { normalizaFrecuencia, esFrecuenciaValida } from './mant-importes.ts'

// Frecuencia de pago de la app → intervalo de Stripe.
// Stripe solo entiende day/week/month/year, así que trimestral y semestral se
// expresan como meses con `interval_count`.
export const FRECUENCIAS: Record<string, { interval: string; interval_count: number; meses: number }> = {
  'Mensual':     { interval: 'month', interval_count: 1,  meses: 1 },
  'Trimestral':  { interval: 'month', interval_count: 3,  meses: 3 },
  'Semestral':   { interval: 'month', interval_count: 6,  meses: 6 },
  'Anual':       { interval: 'year',  interval_count: 1,  meses: 12 },
}

// Se normaliza igual que en `mant-importes.ts`: un 'anual' en minúscula (los
// hay guardados) tiene que dar el intervalo anual, no el mensual por defecto.
export function frecuenciaAStripe(frecuencia: string | null | undefined) {
  return FRECUENCIAS[normalizaFrecuencia(frecuencia) ?? 'Mensual'] ?? FRECUENCIAS['Mensual']
}

// Estado de Stripe → `estado_pago` de la app (el vocabulario que ya usan los
// filtros de la pantalla de mantenimientos y los informes).
export const ESTADO_STRIPE_A_PAGO: Record<string, string> = {
  active:              'Al corriente',
  trialing:            'Al corriente',
  past_due:            'Pendiente de pago',
  unpaid:              'Ultimo aviso',
  incomplete:          'Pendiente de pago',
  incomplete_expired:  'Baja solicitada',
  paused:              'Pausada',
  canceled:            'Baja solicitada',
}

// Fecha de Stripe (epoch en segundos) → 'YYYY-MM-DD' para las columnas `date`.
export function fechaStripe(epochSeconds: number | null | undefined): string | null {
  if (!epochSeconds) return null
  const d = new Date(epochSeconds * 1000)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// ── Customer de Stripe para un cliente / sede ───────────────────────────────
// El Customer es el CLIENTE (entidad fiscal), no la sede: así un único mandato
// SEPA cubre todas sus sedes. Solo se cae al Customer por sede cuando el local
// no cuelga de ningún cliente.
//
// Compartida porque la necesitan DOS caminos que no se pueden desincronizar:
// el alta desde la app (`stripe-suscripcion`) y la firma del contrato
// (`firma-contrato`, que encadena el mandato justo después de firmar). Si cada
// una creara su propio customer, un mismo cliente acabaría con dos fichas en
// Stripe y el mandato firmado no serviría para cobrarle.
export async function asegurarCustomer(
  db: any,
  ctx: StripeCtx,
  ref: { cliente?: any; local?: any },
): Promise<string> {
  const cliente = ref.cliente || ref.local?.clientes || null
  const local   = ref.local || null

  if (cliente?.stripe_customer_id) return cliente.stripe_customer_id
  if (!cliente && local?.stripe_customer_id) return local.stripe_customer_id

  const nombre = cliente?.nombre || local?.nombre || 'Cliente'
  const customer = await stripeReq<any>(ctx, 'POST', 'customers', {
    name: nombre,
    email: cliente?.email || undefined,
    phone: cliente?.telefono || undefined,
    metadata: {
      app: 'okc',
      cliente_id: cliente?.id || '',
      local_id: local?.id || '',
      nif: cliente?.nif || '',
    },
  }, { idempotencyKey: `cust-${cliente?.id || local?.id || nombre}` })

  // El NIF va como tax id español para que salga en los recibos de Stripe. Si
  // Stripe lo rechaza por formato, el alta NO se cae: el cobro funciona igual.
  if (cliente?.nif) {
    await stripeReq(ctx, 'POST', `customers/${customer.id}/tax_ids`, {
      type: 'es_cif', value: cliente.nif,
    }).catch((e: any) => console.warn('[stripe] NIF rechazado por Stripe:', e?.message))
  }

  if (cliente?.id) {
    await db.from('clientes').update({ stripe_customer_id: customer.id }).eq('id', cliente.id)
  } else if (local?.id) {
    await db.from('locales').update({ stripe_customer_id: customer.id }).eq('id', local.id)
  }
  return customer.id
}

// ── Stripe COBRA, no FACTURA ────────────────────────────────────────────────
// Stripe Billing no sabe cobrar una suscripción sin crear una factura suya: la
// finaliza, le pone número de SU serie (`4B5FE4D5-00NN`), y genera página y PDF.
// No se puede desactivar — de hecho el circuito entero cuelga de ese objeto,
// porque el disparador de la factura de Zoho es el evento `invoice.paid`.
//
// Lo que sí se puede es que ese documento no le llegue al cliente ni se
// confunda con la factura. Son tres cosas, y solo dos viven aquí:
//   1. Apagar los correos de Stripe (Settings → Emails → «Successful payments»
//      y «Failed payments»). Es un ajuste de CUENTA, no hay API: se hace a mano
//      una vez, y está en la puesta en marcha de docs/MANTENIMIENTO_STRIPE.md.
//   2. Dejarlo escrito en el propio documento de Stripe (esto).
//   3. No enseñarlo en la app como si fuera la factura (`mant-cobros.js`).
//
// La factura es SIEMPRE la de Zoho Books, serie MANT-AAAA-NNNN: es la que lleva
// el desglose del impuesto y los datos fiscales de la empresa. La de Stripe ni
// siquiera trae el NIF (la cuenta no tiene `account_tax_ids`).
export const AVISO_DOC_INTERNO =
  'Documento interno de cobro. La factura oficial la emite Ok Computer Tenerife ' +
  'en su serie MANT- y se envía por correo aparte desde Zoho Books.'

export const DESCRIPCION_SUSCRIPCION =
  'Cuota de mantenimiento informático. ' + AVISO_DOC_INTERNO

// Deja el aviso en el pie de las facturas que Stripe genere para este cliente.
// Se llama en el alta —vale igual para un customer recién creado y para uno que
// ya existía, que es el caso de un cliente con varias sedes—, y nunca tumba el
// alta: que el pie no se ponga es un problema de presentación, no de cobro.
export async function marcarDocumentoInterno(ctx: StripeCtx, customerId: string): Promise<void> {
  if (!customerId) return
  await stripeReq(ctx, 'POST', `customers/${customerId}`, {
    invoice_settings: { footer: AVISO_DOC_INTERNO },
  }).catch((e: any) => console.warn('[stripe] no se pudo marcar el pie de factura:', e?.message))
}

// ── Saldo a favor del cliente ───────────────────────────────────────────────
// Un abono no devuelve dinero al banco: se le apunta al cliente como crédito y
// Stripe lo descuenta SOLO de la factura siguiente, sin que haya que acordarse.
//
// OJO con el signo: en Stripe el saldo del cliente es una DEUDA cuando es
// positivo. Un crédito a su favor es NEGATIVO. Poner aquí un importe en
// positivo le cargaría de más en la cuota siguiente en vez de descontarle, así
// que esta función recibe el importe en positivo y lo niega ella: quien la
// llama no tiene que acordarse del convenio.
export async function darSaldoAFavor(
  ctx: StripeCtx, customerId: string, centimos: number, descripcion: string,
): Promise<string> {
  if (!customerId) throw new Error('Falta el cliente de Stripe al que dar el saldo')
  const importe = Math.abs(Math.round(centimos))
  if (!importe) throw new Error('El saldo a favor tiene que ser mayor que cero')
  const txn = await stripeReq<any>(ctx, 'POST', `customers/${customerId}/balance_transactions`, {
    amount: -importe,
    currency: 'eur',
    description: descripcion.slice(0, 350),
  })
  return txn?.id as string
}

// ── Métodos de pago ─────────────────────────────────────────────────────────
// La app los llama `card`/`sepa` (es lo que guarda `mant_config.pago_metodos`
// y lo que elige el cliente en la página de firma); Stripe los llama `card` y
// `sepa_debit`. La traducción vive aquí para que no haya dos tablas sueltas.
export const METODOS_PAGO = ['card', 'sepa'] as const
export type MetodoPago = typeof METODOS_PAGO[number]

export function esMetodoPago(v: unknown): v is MetodoPago {
  return typeof v === 'string' && (METODOS_PAGO as readonly string[]).includes(v)
}

export const METODOS_STRIPE: Record<string, string> = { card: 'card', sepa: 'sepa_debit' }

export function metodosAStripe(metodos: unknown): string[] {
  const lista = (Array.isArray(metodos) ? metodos : [metodos])
    .map(m => METODOS_STRIPE[String(m)])
    .filter(Boolean) as string[]
  // Sin métodos válidos se ofrecen los dos: dejar la sesión sin ninguno haría
  // que Stripe la rechazara y el cliente se quedaría sin poder pagar.
  return lista.length ? [...new Set(lista)] : ['card', 'sepa_debit']
}

// Sesión de Stripe Checkout en modo `setup`: recoge el medio de pago (tarjeta
// o IBAN, según lo que se le ofrezca) y, con SEPA, firma el mandato. No cobra
// nada: la suscripción cobra después, sola, con ese medio de pago. Ni la
// tarjeta ni el IBAN pasan por nuestra app: se teclean en una página de Stripe.
export async function crearSesionMandato(
  ctx: StripeCtx,
  customerId: string,
  appUrl: string,
  metadata: Record<string, string> = {},
  metodos: unknown = ['card', 'sepa'],
): Promise<any> {
  return await stripeReq<any>(ctx, 'POST', 'checkout/sessions', {
    mode: 'setup',
    customer: customerId,
    payment_method_types: metodosAStripe(metodos),
    locale: 'es',
    currency: 'eur',
    success_url: `${appUrl}/mandato.html?estado=ok`,
    cancel_url: `${appUrl}/mandato.html?estado=cancelado`,
    metadata: { app: 'okc', ...metadata },
  })
}
