// Portado de la app (_shared/stripe-cobros.ts, paridad bloque 4, tanda 3).
// Cambios: Zoho del hub (zoho-ctx.ts), la sede se lee sin «embed» (el espejo
// no tiene claves foráneas), la vuelta del pago es la del hub y la forma de
// pago dice la frecuencia de verdad (la app ponía «Stripe Mensual» también a
// las trimestrales y semestrales).
// ════════════════════════════════════════════════════════════════════════
// MOTOR DE COBRO DEL MANTENIMIENTO — STRIPE
//
// El alta de una sede (crear la suscripción y conseguir el medio de pago) la
// necesitan DOS caminos que no se pueden desincronizar:
//   · `stripe-suscripcion` — el botón «Domiciliar» de la app.
//   · `firma-contrato`     — el cliente firma y paga en el mismo recorrido.
// Si cada uno hiciera su propia versión, un arreglo en uno dejaría al otro con
// la lógica vieja (que es justo lo que pasó con el importe de la cuota). Por eso
// vive aquí.
//
// Reparto: Stripe = pasarela Y calendario (él cobra la cuota cada periodo y
// avisa por webhook) · Zoho Books = registro fiscal (`stripe-webhook` emite la
// factura de la serie MANT-AAAA-NNNN) · Supabase = espejo del estado y libro.
//
// Tarjeta y SEPA, las dos por Stripe: el cliente mete sus datos en una página
// de Stripe Checkout (modo `setup`) y ni el PAN ni el IBAN pasan por la app.
// Con SEPA, ese paso es el que firma el mandato.
//
// Stripe es la ÚNICA pasarela. La cartera vieja de Zoho Billing sigue en solo
// lectura mientras quede algo sin migrar, y es lo único que puede estorbar un
// alta aquí: `zohoSigueCobrando()` lo decide, para que a una sede no se le
// cobre la cuota por dos sitios.
// ════════════════════════════════════════════════════════════════════════

import {
  StripeCtx, stripeReq, aCentimos, frecuenciaAStripe, ESTADO_STRIPE_A_PAGO,
  fechaStripe, asegurarCustomer, crearSesionMandato, importeACobrar, normalizaFrecuencia,
  importeNetoDeSede, marcarDocumentoInterno, DESCRIPCION_SUSCRIPCION,
} from './stripe.ts'
import { zohoCtx, zohoAccessToken } from './zoho-ctx.ts'
import { fetchTaxPercent } from './zoho-factura-mant.ts'
import { zohoSigueCobrando } from './zoho-subscription.ts'

export const APP_URL = Deno.env.get('HUB_URL') || 'https://okhub-tenerife.web.app'

// ── ¿De quién es esta sede? ─────────────────────────────────────────────────
// Sede que ya se está cobrando por Stripe: tiene suscripción Y medio de pago.
// Una suscripción sin mandato está a medias (el cliente no llegó a pagar), y a
// esa sí se le vuelve a ofrecer el enlace.
export function cobrandoStripe(local: any): boolean {
  return !!local?.stripe_subscription_id && local?.stripe_mandato_estado === 'activo'
}

// ── Configuración ───────────────────────────────────────────────────────────
// Configuración de facturación + el % del impuesto ya resuelto. Hace falta en
// casi todas las acciones porque los precios de la app son NETOS y Stripe tiene
// que cobrar el importe con impuesto. Se cachea el % en `mant_config` para no
// preguntárselo a Zoho en cada alta.
export async function cargarConfig(db: any) {
  const { data } = await db.from('mant_config').select('*').eq('id', true).single()
  const cfg = data || {
    precio_incluye_impuesto: false, zoho_tax_id: null, zoho_tax_percent: null,
    facturar_automatico: true, pago_metodos: ['card', 'sepa'],
  }

  if (cfg.zoho_tax_id && (cfg.zoho_tax_percent === null || cfg.zoho_tax_percent === undefined)) {
    try {
      const ctx = zohoCtx()
      const pct = await fetchTaxPercent(ctx, await zohoAccessToken(ctx), cfg.zoho_tax_id)
      if (pct !== null) {
        cfg.zoho_tax_percent = pct
        await db.from('mant_config').update({ zoho_tax_percent: pct }).eq('id', true)
      }
    } catch (e: any) {
      // Sin el %, cobrar la base pelada dejaría facturas que no cuadran: mejor
      // parar aquí y decirlo que arrastrar el error hasta la contabilidad.
      throw new Error(`No se pudo leer el impuesto configurado en Zoho: ${e?.message || e}`)
    }
  }
  // Precio neto con un impuesto configurado pero sin porcentaje = no se puede
  // saber cuánto cobrar. Es un fallo de configuración, no un caso a improvisar.
  if (!cfg.precio_incluye_impuesto && cfg.zoho_tax_id && !cfg.zoho_tax_percent) {
    throw new Error('Falta el porcentaje del impuesto. Vuelve a elegirlo en Ajustes de facturación.')
  }
  if (!Array.isArray(cfg.pago_metodos) || !cfg.pago_metodos.length) cfg.pago_metodos = ['card', 'sepa']
  return cfg
}

// ── La sede ─────────────────────────────────────────────────────────────────
// Se trae también `zoho_subscription_id` + `zoho_estado`: son los que dicen si
// a la sede la sigue cobrando la Zoho Billing vieja y hay que quitar las manos.
// El ESTADO hace falta además del id: una suscripción dada de baja o borrada
// allí ya no cobra, y esa sede sí se puede domiciliar aquí.
export const SELECT_LOCAL =
  'id,nombre,cliente_id,plan,importe_mantenimiento,importe_incluye_impuesto,frecuencia_pago,forma_pago,' +
  'estado_pago,stripe_customer_id,stripe_subscription_id,stripe_estado,stripe_mandato_estado,' +
  'zoho_subscription_id,zoho_estado'
export const SELECT_CLIENTE = 'id,nombre,email,telefono,nif,zoho_id,stripe_customer_id'

// Con su cliente en `clientes`, como lo traía el «embed» de la app.
export async function cargarLocal(db: any, localId: string) {
  const { data, error } = await db.from('locales').select(SELECT_LOCAL).eq('id', localId).single()
  if (error || !data) throw new Error('Sede no encontrada')
  const { data: cli } = data.cliente_id
    ? await db.from('clientes').select(SELECT_CLIENTE).eq('id', data.cliente_id).maybeSingle()
    : { data: null }
  return { ...data, clientes: cli ?? null }
}

// La forma de pago de una cuota de Stripe, con su frecuencia.
export const formaPagoStripe = (frecuencia: string) => `Stripe ${frecuencia}`

// ── Precio de la cuota en Stripe ────────────────────────────────────────────
// Price del catálogo si el importe coincide con el del plan; si el cliente
// tiene un precio pactado distinto, `price_data` (precio a medida creado al
// vuelo). Así los importes negociados no ensucian el catálogo con un Price por
// cliente.
export function precioAMedida(planRow: any, plan: string, importePeriodo: number, f: any) {
  const pd: Record<string, unknown> = {
    currency: 'eur',
    unit_amount: importePeriodo,
    recurring: { interval: f.interval, interval_count: f.interval_count },
  }
  if (planRow?.stripe_product_id) pd.product = planRow.stripe_product_id
  else pd.product_data = { name: `Mantenimiento ${plan}` }
  return pd
}

export async function itemPrecio(
  sctx: StripeCtx, planRow: any, plan: string, frecuencia: string, importePeriodo: number,
): Promise<Record<string, unknown>> {
  const f = frecuenciaAStripe(frecuencia)
  const priceCatalogo = planRow?.stripe_precios?.[frecuencia]
  if (priceCatalogo) {
    const p = await stripeReq<any>(sctx, 'GET', `prices/${priceCatalogo}`).catch(() => null)
    if (p && p.active && p.unit_amount === importePeriodo) return { price: priceCatalogo }
  }
  return { price_data: precioAMedida(planRow, plan, importePeriodo, f) }
}

// Importe BRUTO (con impuesto) del periodo, en céntimos, a partir del neto.
export function importePeriodoCentimos(importeNeto: number, frecuencia: string, cfg: any): number {
  const f = frecuenciaAStripe(frecuencia)
  return aCentimos(importeACobrar(importeNeto * f.meses, cfg.zoho_tax_percent, cfg.precio_incluye_impuesto))
}

// ── Enlace para domiciliar (Stripe Checkout, modo setup) ────────────────────
// El cliente mete tarjeta o IBAN en la página de Stripe. Lo que devuelve el
// pago lo recoge `stripe-webhook` (`checkout.session.completed`), que guarda el
// medio de pago como el del cliente y cobra la factura que estuviera esperando.
//
// Se puede pedir con un método concreto (`metodo`, cuando el cliente ya eligió
// en la página de firma) o con los dos, y entonces elige en la página de Stripe.
export async function enlaceMandato(
  db: any, sctx: StripeCtx,
  body: {
    local?: any; local_id?: string | null; contrato_id?: string | null
    metodo?: string | null; metodos?: unknown
  },
) {
  let local: any = body.local || null
  const contratoId: string | null = body.contrato_id || null

  if (!local && body.local_id) local = await cargarLocal(db, body.local_id)
  if (!local && contratoId) {
    const { data: c } = await db.from('contratos')
      .select('id,local_id,cliente_id,cliente_nombre').eq('id', contratoId).single()
    if (!c) throw new Error('Contrato no encontrado')
    if (c.local_id) local = await cargarLocal(db, c.local_id)
    else if (c.cliente_id) {
      // Contrato sin sede concreta: el mandato se firma a nombre del cliente.
      const { data: cli } = await db.from('clientes')
        .select('id,nombre,email,telefono,nif,stripe_customer_id').eq('id', c.cliente_id).single()
      if (!cli) throw new Error('Cliente del contrato no encontrado')
      local = { id: null, nombre: cli.nombre, cliente_id: cli.id, clientes: cli }
    }
  }
  if (!local) throw new Error('Indica la sede o el contrato para generar el enlace de pago')

  const cfg = await cargarConfig(db)
  const metodos = body.metodo ? [body.metodo] : (body.metodos ?? cfg.pago_metodos)

  const customerId = await asegurarCustomer(db, sctx, { local })
  const session = await crearSesionMandato(sctx, customerId, APP_URL, {
    local_id: local.id || '', cliente_id: local.cliente_id || '', contrato_id: contratoId || '',
  }, metodos)

  // Se marca «pendiente» salvo que ya haya un medio de pago activo: generar un
  // enlace nuevo (para cambiar de IBAN, por ejemplo) no invalida el que está
  // cobrando. Quien lo pone en «activo» es siempre el webhook, no esto.
  if (local.id && local.stripe_mandato_estado !== 'activo') {
    await db.from('locales').update({ stripe_mandato_estado: 'pendiente' }).eq('id', local.id)
  }
  if (contratoId) {
    await db.from('contratos').update({
      stripe_customer_id: customerId,
      stripe_checkout_session_id: session.id,
      mandato_estado: 'pendiente',
    }).eq('id', contratoId)
  }

  // La sesión de Checkout caduca a las 24 h: se devuelve la fecha para que la
  // app pueda avisar en vez de dejar al cliente ante un enlace muerto.
  return { ok: true, url: session.url, session_id: session.id, caduca: fechaStripe(session.expires_at) }
}

// ── Alta de la cuota de una sede ────────────────────────────────────────────
// Crea la suscripción de Stripe y devuelve el enlace con el que el cliente deja
// su medio de pago. Si el cliente YA tiene uno (mandato dado por otra sede
// suya), no hay enlace: Stripe cobra la primera cuota sola.
export async function altaSede(
  db: any, sctx: StripeCtx,
  body: {
    local_id: string; plan?: string; frecuencia?: string; importe?: number | null
    metodo?: string | null; empieza_el?: string | null; contrato_id?: string | null
  },
) {
  if (!body.local_id) throw new Error('Falta local_id')
  let local = await cargarLocal(db, body.local_id)

  // Solo estorba la suscripción de Zoho que SIGUE cobrando: una dada de baja,
  // caducada o ya borrada en Zoho no cobra nada, y esa sede tiene que poder
  // domiciliarse aquí. Antes bastaba con que el campo tuviera algo, así que una
  // sede a la que ya se le había dado de baja en Zoho leía «dala de baja en
  // Zoho» para siempre y no había forma de pasarla a Stripe.
  if (zohoSigueCobrando(local)) {
    throw new Error('Esta sede tiene una suscripción ACTIVA en Zoho Billing. Dala de baja allí antes de domiciliarla.')
  }
  // Ya tiene suscripción: NO se crea otra (serían dos cuotas al mes). Si el
  // cliente nunca llegó a domiciliar, lo que hace falta es otro enlace.
  if (local.stripe_subscription_id) {
    if (cobrandoStripe(local)) {
      return { ok: true, ya_domiciliada: true, subscription_id: local.stripe_subscription_id,
               mensaje: 'Esta sede ya tiene la cuota domiciliada.' }
    }
    const link = await enlaceMandato(db, sctx, { local, metodo: body.metodo, contrato_id: body.contrato_id })
    return {
      ok: true, estado: 'pendiente', subscription_id: local.stripe_subscription_id,
      pago_url: link.url, caduca: link.caduca,
      mensaje: 'El alta ya estaba hecha: falta que el cliente deje su medio de pago. Enlace generado.',
    }
  }

  const plan       = body.plan || local.plan
  // Nombre canónico ('Anual', no 'anual'): es lo que se guarda en la sede y lo
  // que decide el intervalo de Stripe y el `forma_pago` de más abajo.
  const frecuencia = normalizaFrecuencia(body.frecuencia || local.frecuencia_pago) ?? 'Mensual'
  if (!plan || plan === 'Sin mantenimiento') throw new Error('La sede no tiene un plan de mantenimiento asignado')

  const { data: planRow } = await db
    .from('planes_mantenimiento').select('*').eq('nombre', plan).maybeSingle()

  const cfg = await cargarConfig(db)

  // El importe que llega en `body` ya viene NETO (lo teclea la app, o lo
  // convierte `firma-contrato` con este mismo helper). El de la sede puede no
  // serlo: la cartera heredada de Zoho Billing lo tiene con el IGIC dentro, y
  // `importeNetoDeSede` es quien lo deshace. Sin eso se le suma el impuesto por
  // segunda vez — lo que le pasó a «Pizzeria GuGioCa» (41,73 € guardados →
  // 44,65 € cobrados). Ver la migración 20260919_importe_bruto_cartera_zoho.sql.
  const importeSede = importeNetoDeSede(local, cfg)
  const importe = body.importe != null
    ? Number(body.importe)
    : (importeSede || Number(planRow?.precio_mensual ?? 0))
  if (!importe || importe <= 0) throw new Error('El importe de la cuota tiene que ser mayor que cero')

  const customerId = await asegurarCustomer(db, sctx, { local })

  // Stripe cobra, NO factura: su documento es un apunte interno y no puede
  // llegarle al cliente como si fuera la factura. El pie lo deja escrito en el
  // propio PDF de Stripe, por si alguien acaba viéndolo (ver el apartado
  // «Stripe no factura» de docs/MANTENIMIENTO_STRIPE.md).
  await marcarDocumentoInterno(sctx, customerId)
  const f = frecuenciaAStripe(frecuencia)

  // `importe` es NETO (lo que se ve en la app); a Stripe se le manda cobrar el
  // importe con impuesto, porque la factura de Zoho se emite por lo cobrado.
  const importePeriodo = importePeriodoCentimos(importe, frecuencia, cfg)
  const item = await itemPrecio(sctx, planRow, plan, frecuencia, importePeriodo)

  // Medio de pago por defecto del cliente (tarjeta guardada o mandato SEPA ya
  // firmado, normalmente por otra sede suya).
  const cliente = await stripeReq<any>(sctx, 'GET', `customers/${customerId}`)
  const pmPorDefecto = cliente?.invoice_settings?.default_payment_method || null

  const params: Record<string, unknown> = {
    customer: customerId,
    items: [item],
    collection_method: 'charge_automatically',
    // Sale impreso en la factura de Stripe: quien la abra tiene que ver que el
    // documento fiscal es otro, el de la serie MANT- que emite Zoho Books.
    description: DESCRIPCION_SUSCRIPCION,
    payment_settings: {
      // Los DOS métodos: la sede puede pagar con tarjeta o por SEPA, y si solo
      // se listara uno Stripe rechazaría la factura al cobrarla con el otro.
      payment_method_types: ['card', 'sepa_debit'],
      save_default_payment_method: 'on_subscription',
    },
    metadata: {
      app: 'okc', local_id: local.id, cliente_id: local.cliente_id || '',
      plan, frecuencia, sede: local.nombre || '',
    },
  }
  if (pmPorDefecto) params.default_payment_method = pmPorDefecto
  // Sin medio de pago todavía: la suscripción nace `incomplete` con la primera
  // factura abierta, y el webhook la cobra en cuanto el cliente domicilie.
  params.payment_behavior = pmPorDefecto ? 'allow_incomplete' : 'default_incomplete'
  if (body.empieza_el) {
    // Alta con la primera cuota en una fecha concreta (p. ej. el día 1).
    params.billing_cycle_anchor = Math.floor(new Date(body.empieza_el).getTime() / 1000)
    params.proration_behavior = 'none'
  }

  const sub = await stripeReq<any>(sctx, 'POST', 'subscriptions', params,
    { idempotencyKey: `sub-${local.id}-${plan}-${frecuencia}` })

  const cambiosLocal: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    stripe_estado: sub.status,
    stripe_mandato_estado: pmPorDefecto ? 'activo' : 'pendiente',
    stripe_ultimo_error: null,
    stripe_sync_at: new Date().toISOString(),
    plan,
    importe_mantenimiento: importe,
    // Lo que se guarda es lo que se manda cobrar, y eso es NETO. La sede deja
    // de ser «heredada de Zoho» en este mismo update (más abajo se le quita el
    // `zoho_subscription_id`), así que el valor ya no lo pisa nadie: el cron
    // diario solo toca las que siguen vinculadas.
    importe_incluye_impuesto: false,
    frecuencia_pago: frecuencia,
    forma_pago: formaPagoStripe(frecuencia),
    estado_pago: ESTADO_STRIPE_A_PAGO[sub.status] || 'Pendiente de pago',
    proxima_cuota: fechaStripe(sub.current_period_end),
  }
  // El customer solo se guarda en la sede cuando NO cuelga de un cliente; si
  // cuelga, ya quedó anotado en `clientes` y escribirlo aquí lo duplicaría.
  if (!local.cliente_id) cambiosLocal.stripe_customer_id = customerId
  // La sede venía de la cartera vieja con la suscripción de Zoho ya muerta (si
  // siguiera cobrando no se habría llegado hasta aquí): se corta el enlace. Un
  // id que apunta a una suscripción de baja no dice nada y hace que el refresco
  // diario siga preguntando por ella y pisando lo que ahora manda, que es
  // Stripe. La deuda que hubiera quedado NO se toca: si algo se debe, se debe.
  if (local.zoho_subscription_id) {
    cambiosLocal.zoho_subscription_id = null
    cambiosLocal.zoho_estado = null
    cambiosLocal.zoho_sync_error = null
  }
  await db.from('locales').update(cambiosLocal).eq('id', local.id)
  local = await cargarLocal(db, local.id)

  if (body.contrato_id) {
    await db.from('contratos').update({
      stripe_customer_id: customerId,
      mandato_estado: pmPorDefecto ? 'activo' : 'pendiente',
      ...(pmPorDefecto ? { mandato_at: new Date().toISOString() } : {}),
    }).eq('id', body.contrato_id)
  }

  // Sin medio de pago no hay nada que cobrar: se devuelve ya el enlace, y así
  // el técnico lo manda en el mismo gesto del alta.
  const link = pmPorDefecto ? null : await enlaceMandato(db, sctx, {
    local, metodo: body.metodo, contrato_id: body.contrato_id,
  })

  return {
    ok: true,
    subscription_id: sub.id,
    estado: sub.status,
    cobrado: !!pmPorDefecto,
    pago_url: link?.url || null,
    // `mandato_url` por compatibilidad con lo que ya leía la app.
    mandato_url: link?.url || null,
    caduca: link?.caduca || null,
    mensaje: pmPorDefecto
      ? 'Alta hecha y primera cuota enviada al cobro con el medio de pago del cliente ✓'
      : 'Alta hecha. Falta que el cliente pague la primera cuota con tarjeta o la domicilie por SEPA.',
  }
}
