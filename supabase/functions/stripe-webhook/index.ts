// stripe-webhook — STRIPE → HUB → ZOHO BOOKS (portada de la app, paridad
// bloque 4, tanda 3). PREPARADA Y SIN CONECTAR: se despliega, pero NO se da de
// alta en Stripe hasta el corte del mantenimiento (decisión de Fran): hasta
// entonces el webhook es el de la app, y dos webhooks emitirían dos facturas
// por cada cuota. Por si alguien la registrara antes de tiempo, mientras el
// área sea de la app contesta 200 sin tocar nada.
// SIN_JWT: la autoriza la firma de Stripe (STRIPE_WEBHOOK_SECRET).
// Cambios respecto de la app: el cliente de datos es el del hub (sb-hub.ts) y
// la sede se lee sin «embed» (el espejo no tiene claves foráneas).
import { dbHub, tablaDelHub } from '../_shared/sb-hub.ts'
import { zohoCtx, zohoAccessToken } from '../_shared/zoho-ctx.ts'
import { emitirCuotaEnZoho } from '../_shared/zoho-factura-mant.ts'
import {
  stripeCtx, stripeReq, verifyStripeSignature, aEuros,
  ESTADO_STRIPE_A_PAGO, fechaStripe,
} from '../_shared/stripe.ts'

// ════════════════════════════════════════════════════════════════════════
// STRIPE → APP → ZOHO BOOKS. La otra mitad de la comunicación bidireccional.
//
// Quien llama aquí es Stripe, no un navegador: no hay sesión de Supabase que
// enseñar, así que esta función va SIN verificación de JWT (como `rmm-agente`)
// y se autoriza sola comprobando la FIRMA del webhook con el secret del
// endpoint. Ver el workflow deploy-supabase.yml: se despliega con
// `--no-verify-jwt`, y hay que lanzarlo A MANO.
//
// Sin CORS a propósito: no lo llama ningún navegador. Añadirlo solo abriría
// la puerta a que una página cualquiera intentase golpear el endpoint.
//
// Lo que hace cada evento:
//   checkout.session.completed / setup_intent.succeeded
//        → el cliente acaba de dejar su medio de pago (tarjeta o mandato SEPA):
//          se guarda como el suyo por defecto y se cobra la cuota que estuviera
//          esperando.
//   customer.subscription.created|updated|deleted
//        → espejo del estado de la suscripción en la sede.
//   invoice.paid
//        → EL EVENTO IMPORTANTE: la cuota está cobrada, se emite la factura en
//          Zoho Books con nuestro número de serie y se marca como cobrada.
//   invoice.payment_failed
//        → devolución del recibo: la sede pasa a "Pendiente de pago" y queda
//          apuntado el motivo que da el banco.
//   charge.refunded / mandate.updated
//        → devoluciones y mandatos revocados.
// ════════════════════════════════════════════════════════════════════════

const EVENTOS = new Set([
  'checkout.session.completed',
  'setup_intent.succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'mandate.updated',
])

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 })

  const sctx = stripeCtx()
  // El cuerpo CRUDO, tal cual llegó. Un JSON.parse + stringify por el camino
  // cambiaría los espacios y la firma dejaría de cuadrar.
  const raw = await req.text()
  const firma = req.headers.get('Stripe-Signature') ?? ''

  const check = await verifyStripeSignature(raw, firma, sctx.webhookSecret)
  if (!check.ok) {
    console.warn('[stripe-webhook] firma rechazada:', check.reason)
    return new Response(JSON.stringify({ error: check.reason }), { status: 400 })
  }

  const evento = JSON.parse(raw)
  const db = dbHub('stripe-webhook')

  // Sin el corte, el que cobra y factura es la app: aquí no se toca nada.
  if (!(await tablaDelHub(db, 'mant_facturas'))) {
    return new Response(JSON.stringify({ ok: true, ignorado: 'el mantenimiento se lleva en la app' }), { status: 200 })
  }

  if (!EVENTOS.has(evento.type)) {
    // 200 a propósito: si se responde error, Stripe reintenta durante días un
    // evento que nunca vamos a querer.
    return new Response(JSON.stringify({ ok: true, ignorado: evento.type }), { status: 200 })
  }

  // ── Idempotencia ──────────────────────────────────────────────────────────
  // Stripe reintenta los webhooks que no contesta 2xx. Sin este candado, un
  // reintento de `invoice.paid` emitiría una SEGUNDA factura con otro número.
  // La clave primaria del evento es lo que convierte el reintento en un no-op.
  const { error: dupErr } = await db.from('stripe_eventos').insert({
    id: evento.id,
    tipo: evento.type,
    payload: evento.data?.object ?? null,
  })
  if (dupErr) {
    // 23505 = clave duplicada → ya lo procesamos (o se está procesando).
    if (dupErr.code === '23505') {
      return new Response(JSON.stringify({ ok: true, repetido: evento.id }), { status: 200 })
    }
    console.error('[stripe-webhook] no se pudo registrar el evento:', dupErr.message)
    // Se sigue: perder la trazabilidad es malo, no cobrar es peor.
  }

  let ok = true
  let mensajeError: string | null = null
  try {
    await procesar(db, sctx, evento)
  } catch (e: any) {
    ok = false
    mensajeError = String(e?.message || e).slice(0, 1000)
    console.error(`[stripe-webhook] ${evento.type}:`, mensajeError)
  }

  await db.from('stripe_eventos')
    .update({ procesado_at: new Date().toISOString(), ok, error: mensajeError })
    .eq('id', evento.id)

  // SIEMPRE 200, incluso si el procesado falló. Si se devolviera un error,
  // Stripe reintentaría, pero el candado de idempotencia ya descarta el
  // reintento: se repetiría el ruido sin arreglar nada. El fallo queda en
  // `stripe_eventos` (con índice propio) y en `mant_facturas` para reintentarlo
  // a mano desde la app, que es donde se puede mirar qué pasó.
  return new Response(JSON.stringify({ ok, error: mensajeError }), { status: 200 })
})

async function procesar(db: any, sctx: any, evento: any) {
  const obj = evento.data?.object ?? {}
  switch (evento.type) {
    case 'checkout.session.completed':      return await mandatoCompletado(db, sctx, obj)
    case 'setup_intent.succeeded':          return await setupCompletado(db, sctx, obj)
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':   return await espejoSuscripcion(db, obj, evento.type)
    case 'invoice.paid':                    return await cuotaCobrada(db, obj)
    case 'invoice.payment_failed':          return await cuotaFallida(db, obj)
    case 'charge.refunded':                 return await cobroDevuelto(db, obj)
    case 'mandate.updated':                 return await mandatoActualizado(db, sctx, obj)
  }
}

// ── Localizar la sede ──────────────────────────────────────────────────────
async function sedePorSuscripcion(db: any, subscriptionId: string | null) {
  if (!subscriptionId) return null
  const { data } = await db.from('locales')
    .select('id,nombre,cliente_id,plan,importe_mantenimiento,frecuencia_pago')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()
  return data
}

async function sedesPorCustomer(db: any, customerId: string | null): Promise<string[]> {
  if (!customerId) return []
  // La sede puede colgar del cliente (caso normal, un mandato para todas sus
  // sedes) o llevar el customer encima (sedes sueltas sin cliente): hay que
  // mirar por los dos lados o se quedaría media cartera sin actualizar.
  const ids = new Set<string>()

  const { data: clientes } = await db.from('clientes').select('id').eq('stripe_customer_id', customerId)
  if (clientes?.length) {
    const { data: sedes } = await db.from('locales').select('id')
      .in('cliente_id', clientes.map((c: any) => c.id))
    for (const s of sedes || []) ids.add(s.id)
  }

  const { data: sueltas } = await db.from('locales').select('id').eq('stripe_customer_id', customerId)
  for (const s of sueltas || []) ids.add(s.id)

  return [...ids]
}

// ── El cliente acaba de domiciliar ─────────────────────────────────────────
async function mandatoCompletado(db: any, sctx: any, session: any) {
  if (session.mode !== 'setup') return          // otras sesiones no nos incumben
  if (!session.setup_intent) return

  const si = await stripeReq<any>(sctx, 'GET', `setup_intents/${session.setup_intent}`)
  await guardarMetodoPago(db, sctx, si.customer, si.payment_method, {
    local_id: session.metadata?.local_id || null,
    contrato_id: session.metadata?.contrato_id || null,
  })
}

async function setupCompletado(db: any, sctx: any, si: any) {
  // Llega también cuando el cliente cambia el IBAN desde el portal de Stripe,
  // que no pasa por ninguna sesión de Checkout nuestra.
  await guardarMetodoPago(db, sctx, si.customer, si.payment_method, {
    local_id: si.metadata?.local_id || null,
    contrato_id: si.metadata?.contrato_id || null,
  })
}

async function guardarMetodoPago(
  db: any, sctx: any, customerId: string, paymentMethodId: string,
  ref: { local_id: string | null; contrato_id: string | null },
) {
  if (!customerId || !paymentMethodId) return

  // Método de pago por defecto del cliente: lo que hará que Stripe cobre solo
  // las próximas cuotas sin volver a preguntar.
  await stripeReq(sctx, 'POST', `customers/${customerId}`, {
    invoice_settings: { default_payment_method: paymentMethodId },
  })

  // Con qué paga: se le pregunta a Stripe en vez de darlo por hecho. Desde que
  // el cliente puede elegir tarjeta en el mismo enlace, marcar toda alta como
  // «Domiciliación» dejaba la ficha del sitio diciendo lo que no era.
  const pm = await stripeReq<any>(sctx, 'GET', `payment_methods/${paymentMethodId}`).catch(() => null)
  const formaPago = pm?.type === 'card' ? 'Stripe Tarjeta'
    : pm?.type === 'sepa_debit' ? 'Stripe SEPA' : 'Domiciliación'

  // Y en las suscripciones que ya existan de ese cliente: una suscripción
  // creada ANTES del mandato no hereda el método por defecto del cliente.
  //
  // De aquí salen las dos cosas que antes no se apuntaban en ningún sitio: si
  // el cobro se quedó EN VUELO (SEPA, lo normal) o si no llegó a salir.
  let cobroEnCurso: string | null = null
  let errorCobro: string | null = null

  const subs = await stripeReq<any>(sctx, 'GET', 'subscriptions', { customer: customerId, limit: 100, status: 'all' })
  for (const sub of subs.data || []) {
    if (['canceled', 'incomplete_expired'].includes(sub.status)) continue
    await stripeReq(sctx, 'POST', `subscriptions/${sub.id}`, { default_payment_method: paymentMethodId })

    // Si la suscripción se quedó esperando el mandato, hay una factura abierta
    // que ya se puede cobrar: sin este empujón se quedaría esperando al
    // reintento automático de Stripe.
    if (['incomplete', 'past_due', 'unpaid'].includes(sub.status) && sub.latest_invoice) {
      const invId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice.id
      try {
        const inv = await stripeReq<any>(sctx, 'POST', `invoices/${invId}/pay`, { payment_method: paymentMethodId })
        // Con SEPA el cobro NO es inmediato: el adeudo tarda unos 6 días
        // hábiles y la factura sigue `open` con el pago en `processing`. No es
        // un fallo, pero tampoco está cobrado, y hasta ahora no quedaba
        // constancia de ninguna de las dos cosas: la sede se ponía «Al
        // corriente» y no había forma de distinguir «el dinero viene de camino»
        // de «el cobro no salió» sin entrar en el panel de Stripe.
        if (inv?.status !== 'paid') cobroEnCurso = new Date().toISOString()
      } catch (e: any) {
        // Esto se tragaba con un `console.warn` y no lo veía nadie: si el cobro
        // no arrancaba, la sede se quedaba igual de verde que una cobrada.
        errorCobro = `No se pudo lanzar el cobro de la primera cuota: ${String(e?.message || e)}`.slice(0, 500)
        console.error('[stripe-webhook]', errorCobro)
      }
    }
  }

  // Espejo en la app.
  const cambios = {
    stripe_mandato_estado: 'activo',
    // En el camino bueno sigue limpiándose el error anterior; si el cobro no
    // arrancó, queda escrito y sale en rojo en Cobros y en la ficha del sitio.
    stripe_ultimo_error: errorCobro,
    stripe_cobro_en_curso_at: cobroEnCurso,
    forma_pago: formaPago,
    stripe_sync_at: new Date().toISOString(),
  }
  if (ref.local_id) {
    await db.from('locales').update(cambios).eq('id', ref.local_id)
  } else {
    const ids = await sedesPorCustomer(db, customerId)
    if (ids.length) await db.from('locales').update(cambios).in('id', ids)
  }

  if (ref.contrato_id) {
    await db.from('contratos').update({
      mandato_estado: 'activo',
      mandato_at: new Date().toISOString(),
      stripe_customer_id: customerId,
    }).eq('id', ref.contrato_id)
  }
}

// ── Espejo del estado de la suscripción ────────────────────────────────────
async function espejoSuscripcion(db: any, sub: any, tipo: string) {
  const sede = await sedePorSuscripcion(db, sub.id)
  if (!sede) return   // suscripción que no es nuestra o sede ya borrada

  if (tipo === 'customer.subscription.deleted') {
    await db.from('locales').update({
      stripe_estado: 'canceled',
      estado_pago: 'Baja solicitada',
      stripe_subscription_id: null,
      proxima_cuota: null,
      stripe_sync_at: new Date().toISOString(),
    }).eq('id', sede.id)
    return
  }

  const pausada = !!sub.pause_collection
  await db.from('locales').update({
    stripe_estado: pausada ? 'paused' : sub.status,
    estado_pago: pausada ? 'Pausada' : (ESTADO_STRIPE_A_PAGO[sub.status] || 'Al corriente'),
    proxima_cuota: fechaStripe(sub.current_period_end),
    stripe_sync_at: new Date().toISOString(),
  }).eq('id', sede.id)
}

// ── LA CUOTA ESTÁ COBRADA: emitir la factura en Zoho ───────────────────────
async function cuotaCobrada(db: any, inv: any) {
  const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id
  const sede = await sedePorSuscripcion(db, subId)

  // Lo que VALE el periodo, no lo que entró en la cuenta. Cuando el cliente
  // tiene saldo a favor de un abono anterior, Stripe se lo descuenta y cobra
  // menos; pero la factura tiene que decir el precio del periodo y llevar el
  // abono aplicado contra ella. Si se facturase lo cobrado a secas, ese abono
  // se quedaría abierto en Zoho para siempre y los dos libros dejarían de
  // cuadrar. Ver `20260920_abonos_mantenimiento.sql`.
  const importe = aEuros(inv.total ?? inv.amount_paid ?? 0)
  // Cuánto saldo se consumió de verdad: la diferencia entre el saldo que tenía
  // el cliente al emitirse la factura y el que le queda después. Restar solo
  // `starting_balance` daría de más cuando el crédito es mayor que la cuota.
  const saldoAplicado = Math.max(0, aEuros((inv.ending_balance ?? 0) - (inv.starting_balance ?? 0)))
  const periodoInicio = fechaStripe(inv.lines?.data?.[0]?.period?.start ?? inv.period_start)
  const periodoFin    = fechaStripe(inv.lines?.data?.[0]?.period?.end   ?? inv.period_end)
  const fechaEmision  = fechaStripe(inv.status_transitions?.paid_at ?? inv.created) || new Date().toISOString().slice(0, 10)

  // La fila del libro se crea SIEMPRE, aunque Zoho falle después: es lo que
  // deja constancia de que se cobró un dinero, que es el dato que no se puede
  // perder. La factura de Zoho se cuelga de ella cuando salga bien.
  const { data: filaExistente } = await db.from('mant_facturas')
    .select('id,numero_serie,zoho_invoice_id')
    .eq('stripe_invoice_id', inv.id).maybeSingle()

  let filaId = filaExistente?.id ?? null
  if (!filaId) {
    const { data: nueva, error } = await db.from('mant_facturas').insert({
      local_id: sede?.id ?? null,
      cliente_id: sede?.cliente_id ?? null,
      plan: sede?.plan ?? null,
      stripe_invoice_id: inv.id,
      stripe_subscription_id: subId ?? null,
      stripe_customer_id: typeof inv.customer === 'string' ? inv.customer : inv.customer?.id,
      stripe_payment_intent_id: typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id,
      stripe_hosted_url: inv.hosted_invoice_url ?? null,
      stripe_pdf_url: inv.invoice_pdf ?? null,
      periodo_inicio: periodoInicio,
      periodo_fin: periodoFin,
      fecha_emision: fechaEmision,
      importe,
      saldo_aplicado: saldoAplicado,
      moneda: inv.currency || 'eur',
      estado: 'pagada',
      zoho_estado: 'pendiente',
    }).select('id').single()
    if (error) throw new Error(`No se pudo registrar el cobro: ${error.message}`)
    filaId = nueva.id
  } else if (filaExistente?.zoho_invoice_id) {
    return   // ya facturada: nada que hacer
  }

  // Cuota al día en la sede. El cobro que estuviera en vuelo ya ha liquidado:
  // se borra la marca o la sede se quedaría «cobrándose» para siempre.
  if (sede) {
    await db.from('locales').update({
      estado_pago: 'Al corriente',
      stripe_ultimo_error: null,
      stripe_cobro_en_curso_at: null,
      proxima_cuota: periodoFin,
      stripe_sync_at: new Date().toISOString(),
    }).eq('id', sede.id)
  }

  // ── Factura en Zoho Books, serie propia ─────────────────────────────────
  // La emisión vive en `_shared/zoho-factura-mant.ts` porque el botón
  // «Reintentar factura» de la app hace exactamente lo mismo: compartirla es lo
  // que evita que un arreglo en un camino deje el otro con la lógica vieja.
  const { data: cfg } = await db.from('mant_config').select('facturar_automatico').eq('id', true).single()
  if (!cfg?.facturar_automatico) return   // emisión manual desde la app

  const ctx   = zohoCtx()
  const token = await zohoAccessToken(ctx)
  const res   = await emitirCuotaEnZoho(db, ctx, token, filaId)
  if (!res.ok) throw new Error(res.error || 'No se pudo emitir la factura en Zoho')
}

// ── El recibo ha sido devuelto ─────────────────────────────────────────────
async function cuotaFallida(db: any, inv: any) {
  const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id
  const sede = await sedePorSuscripcion(db, subId)

  // El motivo del banco es lo que hace útil el aviso: "cuenta cancelada" y
  // "sin fondos" se resuelven de forma muy distinta.
  const motivo = inv.last_finalization_error?.message
    || inv.charge?.failure_message
    || 'El banco ha devuelto el recibo domiciliado.'

  // Si esa factura ya se cobró y se emitió en Zoho, no se degrada: un
  // `payment_failed` que llega tarde (reintento de Stripe fuera de orden) no
  // puede convertir una cuota facturada en "fallida".
  const { data: yaFacturada } = await db.from('mant_facturas')
    .select('id,zoho_invoice_id').eq('stripe_invoice_id', inv.id).maybeSingle()
  if (yaFacturada?.zoho_invoice_id) return

  await db.from('mant_facturas').upsert({
    local_id: sede?.id ?? null,
    cliente_id: sede?.cliente_id ?? null,
    plan: sede?.plan ?? null,
    stripe_invoice_id: inv.id,
    stripe_subscription_id: subId ?? null,
    stripe_customer_id: typeof inv.customer === 'string' ? inv.customer : inv.customer?.id,
    stripe_hosted_url: inv.hosted_invoice_url ?? null,
    periodo_inicio: fechaStripe(inv.period_start),
    periodo_fin: fechaStripe(inv.period_end),
    importe: aEuros(inv.amount_due ?? inv.total ?? 0),
    moneda: inv.currency || 'eur',
    estado: 'fallida',
    intento: inv.attempt_count ?? null,
    error_pago: String(motivo).slice(0, 500),
    // Un recibo devuelto NO se factura: no hay cobro que registrar. Se factura
    // cuando el reintento de Stripe salga bien y llegue el `invoice.paid`.
    zoho_estado: 'pendiente',
  }, { onConflict: 'stripe_invoice_id' })

  if (sede) {
    await db.from('locales').update({
      estado_pago: (inv.attempt_count ?? 1) >= 2 ? 'Ultimo aviso' : 'Pendiente de pago',
      stripe_ultimo_error: String(motivo).slice(0, 500),
      // El cobro que estaba en vuelo ha vuelto devuelto: ya no está en curso.
      stripe_cobro_en_curso_at: null,
      stripe_sync_at: new Date().toISOString(),
    }).eq('id', sede.id)
  }
}

async function cobroDevuelto(db: any, charge: any) {
  const invId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id
  if (!invId) return
  // Devolución parcial o total: la factura de Zoho NO se anula sola (un abono
  // es un documento fiscal que hay que emitir a conciencia). Se marca para que
  // salte a la vista en la app.
  await db.from('mant_facturas').update({
    estado: 'reembolsada',
    error_pago: `Devuelto ${aEuros(charge.amount_refunded ?? 0)} €. Falta emitir el abono en Zoho Books.`,
  }).eq('stripe_invoice_id', invId)
}

async function mandatoActualizado(db: any, sctx: any, mandate: any) {
  // Un mandato revocado (por el cliente o por el banco) deja las cuotas
  // siguientes sin forma de cobro: hay que verlo ANTES de la devolución.
  if (mandate.status === 'active') return

  const pmId = typeof mandate.payment_method === 'string' ? mandate.payment_method : mandate.payment_method?.id
  if (!pmId) return
  const pm = await stripeReq<any>(sctx, 'GET', `payment_methods/${pmId}`).catch(() => null)
  const customerId = typeof pm?.customer === 'string' ? pm.customer : pm?.customer?.id
  if (!customerId) return

  const ids = await sedesPorCustomer(db, customerId)
  if (!ids.length) return
  await db.from('locales').update({
    stripe_mandato_estado: mandate.status === 'inactive' ? 'cancelado' : 'fallido',
    stripe_ultimo_error: 'El mandato SEPA ya no está activo: hay que volver a domiciliar.',
    stripe_sync_at: new Date().toISOString(),
  }).in('id', ids)
}
