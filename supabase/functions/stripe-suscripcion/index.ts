// stripe-suscripcion — APP → STRIPE (portada de la app, paridad bloque 4,
// tanda 3). PREPARADA Y SIN CONECTAR: mientras el área `mantenimiento` sea de
// la app contesta 409 a todo (la cuota la cobra y la factura la app), y sin
// STRIPE_SECRET_KEY en los secrets del hub no puede hablar con Stripe.
// Cambios respecto de la app: el cliente de datos es el del hub (sb-hub.ts),
// «Cambiar plan» normaliza la frecuencia (la app la buscaba cruda en
// `stripe_precios` y la guardaba cruda: un 'anual' en minúscula se cobraba
// mensual) y la forma de pago dice la frecuencia de verdad.
import { makeCorsHeaders, getAuthedUser, unauthorized, isAdminUser, forbidden } from '../_shared/http.ts'
import { dbHub, tablaDelHub } from '../_shared/sb-hub.ts'
import { zohoOpcionesFacturacion } from '../_shared/zoho-ctx.ts'
import { emitirCuotaDesdeApp } from '../_shared/zoho-factura-mant.ts'
import {
  stripeCtx, stripeReq, aCentimos, aEuros,
  frecuenciaAStripe, ESTADO_STRIPE_A_PAGO, fechaStripe, normalizaFrecuencia,
  asegurarCustomer, importeACobrar, precioDesdeCobro, importeNetoDeSede, darSaldoAFavor,
} from '../_shared/stripe.ts'
import { emitirAbono } from '../_shared/zoho-abono-mant.ts'
import {
  cargarConfig, cargarLocal, altaSede, enlaceMandato, itemPrecio, importePeriodoCentimos, formaPagoStripe,
} from '../_shared/stripe-cobros.ts'

// ════════════════════════════════════════════════════════════════════════
// APP → STRIPE. Todo lo que la app le PIDE a Stripe sobre el mantenimiento.
// El camino de vuelta (Stripe → app → Zoho) es `stripe-webhook`.
//
// El alta y el enlace de pago no se escriben aquí: viven en
// `_shared/stripe-cobros.ts` porque los comparte con `firma-contrato` (el
// cliente firma y paga de una sentada). Duplicarlos dejaría un camino con la
// lógica vieja en cuanto se tocara el otro.
//
// Una sola función con un `accion` en el cuerpo en vez de diez funciones
// sueltas: comparten cliente de Stripe, resolución de sede/cliente y traducción
// de estados, y así un despliegue las actualiza todas a la vez (recordar que
// las edge functions se despliegan A MANO: Actions → "Deploy Supabase
// Functions", no salen con el push a main).
//
// Acciones:
//   sync_planes   — publica el catálogo de planes como Products/Prices
//   crear         — alta de la cuota de una sede (tarjeta o SEPA)
//   mandato_link  — enlace de Stripe Checkout (modo setup) para pagar/domiciliar
//   portal        — enlace al portal de cliente de Stripe
//   cambiar       — cambio de plan / importe / frecuencia
//   pausar | reanudar | cancelar
//   sincronizar   — trae el estado de Stripe a Supabase (una sede o todas)
//   facturas      — facturas de Stripe de una sede (histórico en vivo)
//   emitir_zoho   — reintenta la factura de Zoho de una cuota que falló
//   zoho_opciones — impuestos y cuentas de Zoho para la pantalla de ajustes
// ════════════════════════════════════════════════════════════════════════

const APP_URL = Deno.env.get('HUB_URL') || 'https://okhub-tenerife.web.app'

Deno.serve(async (req) => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' }, status })

  try {
    const user = await getAuthedUser(req)
    if (!user) return unauthorized(cors)
    // Escribe con la service-role key: solo administradores.
    if (!(await isAdminUser(user))) return forbidden(cors, 'Solo un administrador puede gestionar los cobros de mantenimiento.')

    const db = dbHub('stripe-suscripcion', user.email)
    // Sin el corte, nada: el mantenimiento lo cobra y lo factura la app.
    if (!(await tablaDelHub(db, 'mant_facturas'))) {
      return json({ error: 'El cobro del mantenimiento se sigue llevando en la app hasta el cambio: hazlo allí.', no_activo: true }, 409)
    }
    const sctx = stripeCtx()
    const body = await req.json().catch(() => ({})) as Record<string, any>
    const accion = String(body.accion || '')

    switch (accion) {
      case 'sync_planes':   return json(await syncPlanes(db, sctx))
      case 'crear':         return json(await altaSede(db, sctx, body as { local_id: string }))
      case 'mandato_link':  return json(await enlaceMandato(db, sctx, body))
      case 'portal':        return json(await portalCliente(db, sctx, body))
      case 'cambiar':       return json(await cambiarSuscripcion(db, sctx, body))
      case 'pausar':        return json(await pausarSuscripcion(db, sctx, body, true))
      case 'reanudar':      return json(await pausarSuscripcion(db, sctx, body, false))
      case 'cancelar':      return json(await cancelarSuscripcion(db, sctx, body))
      case 'sincronizar':   return json(await sincronizar(db, sctx, body))
      case 'facturas':      return json(await facturasDeSede(db, sctx, body))
      case 'emitir_zoho':   return json(await emitirCuotaDesdeApp(db, body.factura_id))
      // Abono de una cuota cobrada de más. El saldo en Stripe lo da esta
      // función, que es quien tiene el contexto; la emisión del documento vive
      // en `_shared/zoho-abono-mant.ts`, como la de las facturas.
      case 'abonar':        return json(await emitirAbono(
        db,
        (customerId, centimos, descripcion) => darSaldoAFavor(sctx, customerId, centimos, descripcion),
        body,
        user?.email || null,
      ))
      case 'zoho_opciones': return json(await zohoOpcionesFacturacion())
      default:
        return json({ error: `Acción desconocida: "${accion}"` }, 400)
    }
  } catch (e: any) {
    console.error('[stripe-suscripcion]', e?.message || e)
    return json({ error: e?.message || 'Error inesperado' }, 400)
  }
})

// ── Catálogo: planes_mantenimiento → Products/Prices de Stripe ──────────────
// Los Price de Stripe son INMUTABLES: cambiar el importe de un plan no edita el
// precio, crea uno nuevo y archiva el viejo. Por eso se compara el importe
// antes de crear nada — si no, cada sincronización dejaría un precio huérfano.
async function syncPlanes(db: any, sctx: any) {
  const cfg = await cargarConfig(db)
  const { data: planes } = await db
    .from('planes_mantenimiento')
    .select('id,nombre,precio_mensual,frecuencia_pago,resumen,activo,stripe_product_id,stripe_precios')
    .eq('activo', true)

  const resultado: any[] = []

  for (const plan of planes || []) {
    // "Sin mantenimiento" no se cobra: no tiene sitio en el catálogo de Stripe.
    if (!plan.precio_mensual || plan.nombre === 'Sin mantenimiento') continue

    // 1. Product
    let productId = plan.stripe_product_id
    if (productId) {
      await stripeReq(sctx, 'POST', `products/${productId}`, {
        name: `Mantenimiento ${plan.nombre}`,
        description: plan.resumen || undefined,
      }).catch(() => { productId = null })  // se borró en Stripe → se recrea
    }
    if (!productId) {
      const p = await stripeReq<any>(sctx, 'POST', 'products', {
        name: `Mantenimiento ${plan.nombre}`,
        description: plan.resumen || undefined,
        metadata: { plan: plan.nombre, plan_id: plan.id, app: 'okc' },
      })
      productId = p.id
    }

    // 2. Un Price por frecuencia. El importe de las frecuencias largas es el
    //    mensual multiplicado por los meses del periodo: es lo que se cobra de
    //    una vez, no un descuento por pago adelantado (si algún día lo hay,
    //    va aquí).
    const precios: Record<string, string> = { ...(plan.stripe_precios || {}) }
    for (const frecuencia of ['Mensual', 'Trimestral', 'Semestral', 'Anual']) {
      const f = frecuenciaAStripe(frecuencia)
      // El precio del plan es NETO: el Price de Stripe lleva el importe con
      // impuesto, que es lo que se le carga al cliente y lo que sumará la
      // factura de Zoho.
      const importe = aCentimos(
        importeACobrar(Number(plan.precio_mensual) * f.meses, cfg.zoho_tax_percent, cfg.precio_incluye_impuesto),
      )

      // ¿El precio guardado ya vale? Se comprueba contra Stripe en vez de
      // fiarse de lo que tenemos: el importe del plan pudo cambiar en la app.
      if (precios[frecuencia]) {
        const actual = await stripeReq<any>(sctx, 'GET', `prices/${precios[frecuencia]}`).catch(() => null)
        if (actual && actual.active && actual.unit_amount === importe && actual.product === productId) continue
        // Archivar el precio viejo: deja de ofrecerse, pero las suscripciones
        // que ya lo usan siguen cobrándose con él hasta que se les cambie.
        if (actual?.active) {
          await stripeReq(sctx, 'POST', `prices/${precios[frecuencia]}`, { active: false }).catch(() => {})
        }
      }

      const price = await stripeReq<any>(sctx, 'POST', 'prices', {
        product: productId,
        currency: 'eur',
        unit_amount: importe,
        recurring: { interval: f.interval, interval_count: f.interval_count },
        metadata: { plan: plan.nombre, frecuencia, app: 'okc' },
      })
      precios[frecuencia] = price.id
    }

    await db.from('planes_mantenimiento')
      .update({ stripe_product_id: productId, stripe_precios: precios })
      .eq('id', plan.id)

    resultado.push({ plan: plan.nombre, product: productId, precios })
  }

  return { ok: true, planes: resultado, mensaje: `${resultado.length} plan(es) sincronizados con Stripe` }
}


// El portal de cliente lo gestiona Stripe: el cliente cambia su IBAN, ve sus
// facturas y se descarga los recibos sin que tengamos que construir nada.
async function portalCliente(db: any, sctx: any, body: any) {
  const local = await cargarLocal(db, body.local_id)
  const customerId = await asegurarCustomer(db, sctx, { local })
  const session = await stripeReq<any>(sctx, 'POST', 'billing_portal/sessions', {
    customer: customerId,
    return_url: `${APP_URL}/`,
    locale: 'es',
  })
  return { ok: true, url: session.url }
}

// ── Cambios de plan / importe / frecuencia ─────────────────────────────────
async function cambiarSuscripcion(db: any, sctx: any, body: any) {
  const local = await cargarLocal(db, body.local_id)
  if (!local.stripe_subscription_id) throw new Error('Esta sede no tiene suscripción en Stripe')

  const plan       = body.plan       || local.plan
  // Normalizada (en la app no lo estaba): es la clave de `stripe_precios` y del intervalo.
  const frecuencia = normalizaFrecuencia(body.frecuencia || local.frecuencia_pago) ?? 'Mensual'

  const cfg = await cargarConfig(db)
  // Mismo cuidado que en el alta: el importe guardado de una sede heredada de
  // Zoho Billing lleva el impuesto dentro, y volver a sumárselo aquí subiría la
  // cuota un 7 % en cada «Cambiar plan».
  const importe = body.importe != null ? Number(body.importe) : importeNetoDeSede(local, cfg)
  if (!importe || importe <= 0) throw new Error('El importe tiene que ser mayor que cero')

  const { data: planRow } = await db
    .from('planes_mantenimiento').select('*').eq('nombre', plan).maybeSingle()

  const sub = await stripeReq<any>(sctx, 'GET', `subscriptions/${local.stripe_subscription_id}`)
  const itemId = sub.items?.data?.[0]?.id
  if (!itemId) throw new Error('La suscripción de Stripe no tiene líneas')

  const item = await itemPrecio(sctx, planRow, plan, frecuencia, importePeriodoCentimos(importe, frecuencia, cfg))

  // `proration_behavior` por defecto 'none': un cambio de plan a mitad de mes
  // NO genera un abono ni un cargo suelto, empieza a aplicar en la cuota
  // siguiente. Es lo que espera el cliente de un contrato de mantenimiento; si
  // se quiere prorratear, se pide explícitamente desde la app.
  const actualizada = await stripeReq<any>(sctx, 'POST', `subscriptions/${local.stripe_subscription_id}`, {
    items: [{ id: itemId, ...item }],
    proration_behavior: body.prorratear ? 'create_prorations' : 'none',
    metadata: { app: 'okc', local_id: local.id, cliente_id: local.cliente_id || '', plan, frecuencia },
  })

  await db.from('locales').update({
    plan,
    importe_mantenimiento: importe,
    // Lo guardado pasa a ser el neto que se manda cobrar.
    importe_incluye_impuesto: false,
    frecuencia_pago: frecuencia,
    forma_pago: formaPagoStripe(frecuencia),
    stripe_estado: actualizada.status,
    estado_pago: ESTADO_STRIPE_A_PAGO[actualizada.status] || local.estado_pago,
    proxima_cuota: fechaStripe(actualizada.current_period_end),
    stripe_sync_at: new Date().toISOString(),
  }).eq('id', local.id)

  return { ok: true, estado: actualizada.status, mensaje: `Suscripción actualizada a ${plan} · ${frecuencia}` }
}

async function pausarSuscripcion(db: any, sctx: any, body: any, pausar: boolean) {
  const local = await cargarLocal(db, body.local_id)
  if (!local.stripe_subscription_id) throw new Error('Esta sede no tiene suscripción en Stripe')

  // `pause_collection` con `keep_as_draft`: Stripe sigue generando las facturas
  // pero no las cobra. Al reanudar, el cliente no recibe de golpe todos los
  // cargos atrasados (eso pasaría con `mark_uncollectible` o sin pausa).
  const sub = await stripeReq<any>(sctx, 'POST', `subscriptions/${local.stripe_subscription_id}`,
    pausar
      ? { pause_collection: { behavior: 'keep_as_draft' } }
      : { pause_collection: '' },
  )

  await db.from('locales').update({
    stripe_estado: sub.status,
    estado_pago: pausar ? 'Pausada' : (ESTADO_STRIPE_A_PAGO[sub.status] || 'Al corriente'),
    stripe_sync_at: new Date().toISOString(),
  }).eq('id', local.id)

  return { ok: true, mensaje: pausar ? 'Cobro pausado' : 'Cobro reanudado' }
}

async function cancelarSuscripcion(db: any, sctx: any, body: any) {
  const local = await cargarLocal(db, body.local_id)
  if (!local.stripe_subscription_id) throw new Error('Esta sede no tiene suscripción en Stripe')

  // Por defecto se cancela AL FINAL del periodo ya pagado: el cliente disfruta
  // el mes que abonó. `inmediato` corta hoy mismo y es lo excepcional.
  const sub = body.inmediato
    ? await stripeReq<any>(sctx, 'DELETE', `subscriptions/${local.stripe_subscription_id}`)
    : await stripeReq<any>(sctx, 'POST', `subscriptions/${local.stripe_subscription_id}`, { cancel_at_period_end: true })

  await db.from('locales').update({
    stripe_estado: sub.status,
    estado_pago: 'Baja solicitada',
    proxima_cuota: body.inmediato ? null : fechaStripe(sub.current_period_end),
    stripe_sync_at: new Date().toISOString(),
    ...(body.inmediato ? { stripe_subscription_id: null } : {}),
  }).eq('id', local.id)

  return {
    ok: true,
    mensaje: body.inmediato
      ? 'Suscripción cancelada'
      : `Baja programada para el ${fechaStripe(sub.current_period_end) || 'fin del periodo'}`,
  }
}

// ── Traer el estado de Stripe a Supabase ───────────────────────────────────
// Es la red de seguridad de los webhooks: si uno se perdió (caída, secret mal
// puesto), esto vuelve a cuadrar la app con Stripe sin tocar nada a mano.
async function sincronizar(db: any, sctx: any, body: any) {
  const cfg = await cargarConfig(db)
  const localId = body.local_id || null

  const q = db.from('locales')
    .select('id,nombre,stripe_subscription_id,cliente_id,plan,importe_mantenimiento,importe_incluye_impuesto')
    .not('stripe_subscription_id', 'is', null)
  const { data: sedes } = localId ? await q.eq('id', localId) : await q

  let actualizadas = 0
  const errores: string[] = []
  // Sedes cuya cuota en la app no coincidía con la que cobra Stripe: se
  // devuelven para poder decirlo al terminar, además de dejarlo en la sede.
  const divergentes: { sede: string; app: number; stripe: number }[] = []

  for (const sede of sedes || []) {
    try {
      const sub = await stripeReq<any>(sctx, 'GET', `subscriptions/${sede.stripe_subscription_id}`, {
        'expand[]': 'default_payment_method',
      })
      const pausada = !!sub.pause_collection
      const importePeriodo = sub.items?.data?.[0]?.price?.unit_amount ?? null
      const intervalo = sub.items?.data?.[0]?.price?.recurring
      const meses = intervalo
        ? (intervalo.interval === 'year' ? 12 * intervalo.interval_count : intervalo.interval_count)
        : 1

      const cambios: Record<string, unknown> = {
        stripe_estado: pausada ? 'paused' : sub.status,
        estado_pago: pausada ? 'Pausada' : (ESTADO_STRIPE_A_PAGO[sub.status] || 'Al corriente'),
        proxima_cuota: fechaStripe(sub.current_period_end),
        stripe_mandato_estado: sub.default_payment_method ? 'activo' : 'pendiente',
        stripe_ultimo_error: null,
        stripe_sync_at: new Date().toISOString(),
      }
      // El importe solo se pisa si Stripe lo sabe: mandar `null` borraría la
      // cuota pactada que se ve en la lista de contratos. Y se le quita el
      // impuesto: los importes de la app son NETOS, así que guardar el bruto
      // que cobra Stripe iría inflando el precio en cada sincronización.
      if (importePeriodo != null) {
        const neto = precioDesdeCobro(aEuros(importePeriodo), cfg.zoho_tax_percent, cfg.precio_incluye_impuesto)
        const netoMes = Math.round((neto / meses) * 100) / 100
        cambios.importe_mantenimiento = netoMes
        // Viene de Stripe y ya se le ha quitado el impuesto: es neto.
        cambios.importe_incluye_impuesto = false

        // ── Si la app y Stripe no dicen lo mismo, hay que verlo ─────────────
        // Quien cobra es Stripe, así que su precio es el que manda y se guarda.
        // Pero pisarlo en SILENCIO borraba la única pista de que la cuota se
        // había cambiado por un camino que no pasa por aquí: «Bananas
        // Cafetería» figuraba a 49 €/mes en la app mientras Stripe le cobraba
        // 90,45 €, y sincronizar habría dejado el 84,53 € de Stripe sin que
        // nadie se enterara de que alguna vez fueron 49.
        const anterior = importeNetoDeSede(sede, cfg)
        if (anterior && Math.abs(anterior - netoMes) > 0.01) {
          divergentes.push({ sede: sede.nombre || sede.id, app: anterior, stripe: netoMes })
          cambios.stripe_ultimo_error =
            `La cuota de la app (${anterior.toFixed(2)} €/mes) no cuadraba con la que cobra Stripe ` +
            `(${netoMes.toFixed(2)} €/mes). Se ha guardado la de Stripe, que es la que se cobra. ` +
            `Si la buena es la otra, cámbiala con «Cambiar plan».`
        }
      }
      await db.from('locales').update(cambios).eq('id', sede.id)
      actualizadas++
    } catch (e: any) {
      // Una suscripción borrada en Stripe no debe dejar el resto sin sincronizar.
      errores.push(`${sede.id}: ${e?.message || e}`)
      await db.from('locales')
        .update({ stripe_ultimo_error: String(e?.message || e).slice(0, 500) })
        .eq('id', sede.id)
    }
  }

  return {
    ok: true, actualizadas, errores, divergentes,
    mensaje: `${actualizadas} suscripción(es) sincronizada(s)`
      + (errores.length ? ` · ${errores.length} con error` : '')
      + (divergentes.length ? ` · ${divergentes.length} con la cuota descuadrada` : ''),
  }
}

// Facturas de Stripe de una sede: se leen en vivo para poder ver también las
// que todavía no han generado fila en `mant_facturas` (borradores, abiertas).
async function facturasDeSede(db: any, sctx: any, body: any) {
  const local = await cargarLocal(db, body.local_id)
  if (!local.stripe_subscription_id) return { ok: true, facturas: [] }

  const lista = await stripeReq<any>(sctx, 'GET', 'invoices', {
    subscription: local.stripe_subscription_id,
    limit: body.limit || 24,
  })

  const facturas = (lista.data || []).map((inv: any) => ({
    id: inv.id,
    numero: inv.number,
    estado: inv.status,
    importe: aEuros(inv.amount_due),
    pagado: aEuros(inv.amount_paid),
    fecha: fechaStripe(inv.created),
    periodo_inicio: fechaStripe(inv.period_start),
    periodo_fin: fechaStripe(inv.period_end),
    pdf: inv.invoice_pdf,
    url: inv.hosted_invoice_url,
  }))

  // Se cruza con nuestro libro para saber cuáles ya tienen factura de Zoho.
  const { data: propias } = await db.from('mant_facturas')
    .select('stripe_invoice_id,numero_serie,zoho_invoice_number,zoho_estado,zoho_error')
    .eq('local_id', local.id)
  const porStripe = Object.fromEntries((propias || []).map((f: any) => [f.stripe_invoice_id, f]))

  return {
    ok: true,
    facturas: facturas.map((f: any) => ({ ...f, zoho: porStripe[f.id] || null })),
  }
}

