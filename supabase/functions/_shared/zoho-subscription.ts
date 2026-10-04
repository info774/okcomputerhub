// La cartera vieja de Zoho Billing (portado de _shared/zoho-subscription.ts de
// la app). De momento, solo lo que necesita el motor de cobro de Stripe para
// no cobrar dos veces una sede; el resto (sync de la cartera, deuda) llega con
// la tanda 4 de la paridad del bloque 4.
//
// Tener `zoho_subscription_id` NO significa que la sede se esté cobrando: la
// suscripción puede estar dada de baja, caducada o BORRADA en Zoho. OJO con
// `non_renewing`: la baja está pedida pero SIGUE cobrando hasta que venza el
// periodo, así que no cuenta como muerta.
export const ZOHO_NO_EXISTE = 'no_existe'
export const ESTADOS_ZOHO_MUERTOS = new Set(['cancelled', 'expired', 'cancelled_from_dunning', ZOHO_NO_EXISTE])

const norm = (v: unknown) => (v ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

// Una sede la cobra Stripe o la Zoho Billing vieja, nunca las dos: con
// suscripción de Stripe ya no manda Zoho.
// deno-lint-ignore no-explicit-any
export function zohoSigueCobrando(local: any): boolean {
  if (!local?.zoho_subscription_id) return false
  if (local.stripe_subscription_id) return false
  return !ESTADOS_ZOHO_MUERTOS.has(norm(local.zoho_estado))
}
