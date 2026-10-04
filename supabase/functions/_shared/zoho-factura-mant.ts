// Portado de la app (_shared/zoho-factura-mant.ts, paridad bloque 4, tanda 3).
// Cambios: Zoho del hub (zoho-ctx.ts), sin «embeds» (el espejo no tiene claves
// foráneas) y arreglado el import que faltaba en la app (emitirCuotaDesdeApp
// usaba zohoCtx/zohoAccessToken sin importarlos: «Emitir en Zoho» fallaba).
// Emisión en Zoho Books de la factura de una cuota de mantenimiento YA COBRADA
// (siempre por Stripe: tarjeta o domiciliación SEPA), en la SERIE PROPIA de
// mantenimiento (MANT-AAAA-NNNN).
//
// Por qué numeramos nosotros y no Zoho:
// Zoho Books autonumera con una única secuencia por tipo de documento dentro de
// la organización, así que las cuotas se mezclarían con las facturas de los
// trabajos. Creando la factura con `invoice_number` explícito y
// `ignore_auto_number_generation=true` conseguimos una serie de mantenimiento
// separada y sin huecos, cuyo contador vive en Supabase
// (`siguiente_numero_mant`, migración 20260831_mantenimiento_stripe.sql).
//
// Reserva del número: el número se pide JUSTO ANTES de crear la factura. Si la
// llamada a Zoho falla, ese número queda quemado y la serie tiene un hueco. Es
// el mal menor frente a la alternativa (reutilizarlo y arriesgarse a duplicar
// un número ya emitido), y el hueco queda explicado en `mant_facturas`, que
// guarda la fila con `zoho_estado='error'` y su número reservado.

import { type ZohoCtx, zohoCtx, zohoAccessToken } from './zoho-ctx.ts'
import { baseImponible } from './mant-importes.ts'
import { aplicarCreditoAFactura } from './zoho-abono-mant.ts'

export interface LineaFactura {
  descripcion: string
  cantidad: number
  // Importe TOTAL de la línea, impuesto incluido: exactamente el dinero que
  // Stripe cargó al cliente. La base imponible se deriva de aquí, nunca al
  // revés — así la factura suma siempre lo que entró en la cuenta.
  importe: number
}

export interface ConfigFactura {
  // Ojo: `precio_incluye_impuesto` NO está aquí a propósito. Solo decide cuánto
  // se le manda cobrar a Stripe; en Zoho la base se deriva siempre del cobro.
  zoho_tax_id: string | null
  // Manda la factura al cliente por correo desde Zoho Books, con la plantilla
  // y el remitente que tenga configurados allí.
  enviar_factura_email?: boolean
  zoho_tax_percent: number | null
  zoho_cuenta_cobro_id: string | null
  zoho_notas: string | null
}

// Consulta el % de un impuesto de Zoho Books. Se usa cuando `mant_config` tiene
// el id del impuesto pero todavía no su porcentaje, para poder calcular la base
// imponible hacia atrás desde el total cobrado.
export async function fetchTaxPercent(
  ctx: ZohoCtx, accessToken: string, taxId: string,
): Promise<number | null> {
  const res = await fetch(
    `https://${ctx.apiDomain}/books/v3/settings/taxes/${taxId}?organization_id=${ctx.ZOHO_ORG_ID}`,
    { headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } },
  )
  const data = await res.json().catch(() => ({}))
  const pct = data?.tax?.tax_percentage
  return typeof pct === 'number' ? pct : null
}

export interface ResultadoFactura {
  zoho_invoice_id: string
  zoho_invoice_number: string
  pagada: boolean
  base: number             // base imponible facturada
  impuesto: number         // cuota del impuesto
  email_enviado: boolean   // se mandó al cliente por correo desde Zoho
  destinatarios: string[]  // a qué direcciones fue
  aviso?: string
}

// Crea la factura en Zoho, la marca como enviada y le aplica el cobro.
//
// El pago se registra SIEMPRE que haya cuenta de cobro configurada: la cuota ya
// está cobrada cuando llegamos aquí, y dejar la factura abierta en Zoho haría
// que apareciese como pendiente en todos los informes de deuda.
export async function crearFacturaMantenimiento(opts: {
  ctx: ZohoCtx
  accessToken: string
  zohoCustomerId: string
  numeroSerie: string
  fecha: string                 // 'YYYY-MM-DD' — fecha de emisión
  lineas: LineaFactura[]
  config: ConfigFactura
  referencia?: string | null    // reference_number: el id de la factura de Stripe
  itemId?: string | null        // artículo de Zoho del plan, si lo tiene
  notas?: string | null
  // Parte del total que NO entró en dinero porque Stripe la descontó de un
  // abono anterior. Se aplica contra esta factura como crédito y solo el resto
  // se registra como cobro. Ver `20260920_abonos_mantenimiento.sql`.
  saldoAplicado?: number
}): Promise<ResultadoFactura> {
  const { ctx, accessToken, zohoCustomerId, numeroSerie, fecha, lineas, config } = opts
  const { ZOHO_ORG_ID, apiDomain } = ctx

  const taxId  = config.zoho_tax_id || null
  const taxPct = taxId ? (config.zoho_tax_percent ?? 0) : 0

  // La organización de Zoho factura con impuestos EXCLUSIVOS: suma el impuesto
  // sobre el `rate`. Así que la línea lleva la base imponible, derivada del
  // total cobrado, y Zoho reconstruye el mismo total al aplicar el impuesto.
  const line_items = lineas.map(l => {
    const cantidad   = l.cantidad || 1
    const totalLinea = Number(l.importe) || 0
    const base       = baseImponible(totalLinea, taxPct)
    const item: Record<string, unknown> = {
      description: l.descripcion,
      quantity: cantidad,
      // Cuatro decimales, no dos: con IGIC del 7 % un total de 37,45 € da una
      // base de 35,0000, pero un total de 35 € da 32,7103… y truncar a 32,71
      // desviaría el total unos céntimos respecto de lo cobrado por Stripe.
      rate: Math.round((base / cantidad) * 10000) / 10000,
    }
    if (opts.itemId) item.item_id = opts.itemId
    if (taxId) item.tax_id = taxId
    return item
  })

  const totalCobrado = lineas.reduce((s, l) => s + (Number(l.importe) || 0), 0)

  const payload: Record<string, unknown> = {
    customer_id: zohoCustomerId,
    invoice_number: numeroSerie,
    date: fecha,
    line_items,
  }
  if (opts.referencia) payload.reference_number = opts.referencia
  const notas = [opts.notas, config.zoho_notas].filter(Boolean).join('\n')
  if (notas) payload.notes = notas

  // `ignore_auto_number_generation=true` es lo que hace que Zoho respete
  // NUESTRO invoice_number en vez de pisarlo con el suyo.
  const createRes = await fetch(
    `https://${apiDomain}/books/v3/invoices?organization_id=${ZOHO_ORG_ID}&ignore_auto_number_generation=true`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
  const createData = await createRes.json().catch(() => ({}))
  if (createData.code !== 0) {
    throw new Error(`Zoho: ${createData.message || 'no se pudo crear la factura'}`)
  }

  const zohoInvoiceId = createData.invoice?.invoice_id as string
  const zohoNumber    = (createData.invoice?.invoice_number as string) || numeroSerie
  const total         = Number(createData.invoice?.total ?? 0)

  // Red de seguridad contable: la factura tiene que sumar exactamente lo que
  // Stripe cobró. Si no cuadra, el impuesto configurado no es el que se usó al
  // calcular el precio, y hay que verlo AHORA y no al cerrar el trimestre. No
  // se aborta —la factura ya existe— pero el descuadre queda escrito.
  let aviso: string | undefined
  if (Math.abs(total - totalCobrado) > 0.02) {
    aviso = `Descuadre: Stripe cobró ${totalCobrado.toFixed(2)} € y la factura de Zoho suma ` +
      `${total.toFixed(2)} €. Revisa el impuesto en Ajustes de facturación.`
  }

  // ── Marcar como enviada ───────────────────────────────────────────────────
  // Una factura en borrador no cuenta como emitida a efectos fiscales y no se
  // le puede aplicar un cobro. Si este paso falla no se aborta: la factura ya
  // existe y el aviso sube a `mant_facturas.zoho_error` para arreglarlo a mano.
  const sentRes = await fetch(
    `https://${apiDomain}/books/v3/invoices/${zohoInvoiceId}/status/sent?organization_id=${ZOHO_ORG_ID}`,
    { method: 'POST', headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } },
  )
  const sentData = await sentRes.json().catch(() => ({}))
  if (sentData.code !== 0) {
    aviso = [aviso, `No se pudo marcar como enviada: ${sentData.message || sentRes.status}`]
      .filter(Boolean).join(' · ')
  }

  // ── Aplicar el saldo a favor ──────────────────────────────────────────────
  // Antes de registrar el cobro: lo que se pagó con un abono anterior no entró
  // en la cuenta, así que no puede registrarse como dinero. Y si no se aplicara
  // aquí, el abono se quedaría abierto en Zoho para siempre mientras Stripe ya
  // se lo había descontado al cliente — los dos libros dejarían de cuadrar.
  const saldo = Math.round((opts.saldoAplicado ?? 0) * 100) / 100
  let saldoAplicado = 0
  if (saldo > 0.005) {
    const r = await aplicarCreditoAFactura(ctx, accessToken, zohoCustomerId, zohoInvoiceId, saldo)
    saldoAplicado = r.aplicado
    if (r.aviso) aviso = [aviso, r.aviso].filter(Boolean).join(' · ')
  }

  // ── Registrar el cobro ────────────────────────────────────────────────────
  // Solo el dinero que entró de verdad: el total menos lo que cubrió el abono.
  const enEfectivo = Math.round((total - saldoAplicado) * 100) / 100
  let pagada = false
  if (enEfectivo <= 0.005) {
    // La cuota entera la cubrió el saldo: no hay cobro que registrar y la
    // factura queda saldada por el crédito aplicado.
    pagada = saldoAplicado > 0
  } else if (config.zoho_cuenta_cobro_id) {
    const pagoRes = await fetch(
      `https://${apiDomain}/books/v3/customerpayments?organization_id=${ZOHO_ORG_ID}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customer_id: zohoCustomerId,
          payment_mode: 'banktransfer',
          amount: enEfectivo,
          date: fecha,
          reference_number: opts.referencia || numeroSerie,
          description: 'Cobro automático de la cuota de mantenimiento (Stripe)'
            + (saldoAplicado > 0 ? ` · ${saldoAplicado.toFixed(2)} € cubiertos con saldo a favor` : ''),
          account_id: config.zoho_cuenta_cobro_id,
          invoices: [{ invoice_id: zohoInvoiceId, amount_applied: enEfectivo }],
        }),
      },
    )
    const pagoData = await pagoRes.json().catch(() => ({}))
    if (pagoData.code === 0) {
      pagada = true
    } else {
      aviso = [aviso, `No se pudo registrar el cobro: ${pagoData.message || pagoRes.status}`]
        .filter(Boolean).join(' · ')
    }
  } else {
    aviso = [aviso, 'Sin cuenta de cobro configurada: la factura queda pendiente de cobro en Zoho.']
      .filter(Boolean).join(' · ')
  }

  // ── Mandarla al cliente ───────────────────────────────────────────────────
  // OJO: `status/sent` de arriba NO manda ningún correo, solo saca la factura
  // de borrador. El envío es este otro endpoint, y sin él la factura existe
  // pero el cliente no se entera — que es justo lo que pasaba antes.
  //
  // Va al final a propósito: primero que la factura esté emitida y cobrada, y
  // solo entonces se manda. Así el cliente nunca recibe un documento que
  // todavía figura como pendiente de pago.
  let email_enviado = false
  let destinatarios: string[] = []
  if (config.enviar_factura_email !== false) {
    const envio = await enviarFacturaPorEmail(ctx, accessToken, zohoInvoiceId)
    email_enviado = envio.ok
    destinatarios = envio.destinatarios
    if (!envio.ok) aviso = [aviso, envio.aviso].filter(Boolean).join(' · ')
  }

  return {
    zoho_invoice_id: zohoInvoiceId,
    zoho_invoice_number: zohoNumber,
    pagada,
    base: Number(createData.invoice?.sub_total ?? baseImponible(totalCobrado, taxPct)),
    impuesto: Number(createData.invoice?.tax_total ?? (totalCobrado - baseImponible(totalCobrado, taxPct))),
    email_enviado,
    destinatarios,
    aviso,
  }
}

// Manda la factura por correo desde Zoho Books, con su plantilla y su
// remitente. Sin cuerpo en la petición: así Zoho usa los contactos marcados
// para facturación y el diseño que ya tenga configurado, en vez de que el
// texto del correo viva escondido en este código.
//
// Nunca lanza: un fallo aquí no debe deshacer una factura ya emitida y cobrada.
// El motivo vuelve como aviso y acaba en `mant_facturas.zoho_error`, a la vista
// en la pestaña Cobros, donde se puede reenviar desde Zoho.
async function enviarFacturaPorEmail(
  ctx: ZohoCtx, accessToken: string, zohoInvoiceId: string,
): Promise<{ ok: boolean; destinatarios: string[]; aviso?: string }> {
  const { ZOHO_ORG_ID, apiDomain } = ctx
  try {
    // A quién iría: se consulta antes para poder decir "no tiene email" en vez
    // de un error de Zoho que no explica nada.
    const prevRes = await fetch(
      `https://${apiDomain}/books/v3/invoices/${zohoInvoiceId}/email?organization_id=${ZOHO_ORG_ID}`,
      { headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } },
    )
    const prev = await prevRes.json().catch(() => ({}))
    const destinatarios: string[] = (prev?.data?.to_contacts ?? [])
      .filter((c: any) => c?.email)
      .map((c: any) => c.email as string)

    if (!destinatarios.length) {
      return {
        ok: false,
        destinatarios: [],
        aviso: 'La factura no se envió: el cliente no tiene correo en Zoho Books.',
      }
    }

    const res = await fetch(
      `https://${apiDomain}/books/v3/invoices/${zohoInvoiceId}/email?organization_id=${ZOHO_ORG_ID}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to_mail_ids: destinatarios }),
      },
    )
    const data = await res.json().catch(() => ({}))
    if (data.code === 0) return { ok: true, destinatarios }
    return {
      ok: false,
      destinatarios,
      aviso: `No se pudo enviar la factura por correo: ${data.message || res.status}`,
    }
  } catch (e: any) {
    return { ok: false, destinatarios: [], aviso: `Error al enviar la factura: ${e?.message || e}` }
  }
}

// ── Emisión de la cuota a partir de su fila de `mant_facturas` ───────────────
// La usan DOS caminos: el webhook cuando Stripe confirma el pago, y el botón
// «Reintentar factura» de la app cuando algo falló (cliente sin ficha en Zoho,
// token caducado, impuesto mal configurado). Vive aquí, compartida, para que
// arreglar un caso no deje el otro con la lógica vieja.
//
// Es idempotente: si la fila ya tiene `zoho_invoice_id` no vuelve a facturar.
// Y conserva el `numero_serie` ya reservado, para que un reintento no queme un
// número nuevo dejando un hueco en la serie.
// Reintento manual desde la app («Emitir en Zoho»): misma función que usan el
// webhook y el cron, así que arreglar el motivo del fallo (dar de alta el
// cliente en Zoho, elegir el impuesto) y volver a pulsar es todo lo que hace
// falta: no se duplica la factura ni se quema otro número de la serie. La
// la llama stripe-suscripcion; antes cada camino tenía su copia.
export async function emitirCuotaDesdeApp(db: any, facturaId: string | undefined) {
  if (!facturaId) throw new Error('Falta factura_id')
  const ctx   = zohoCtx()
  const token = await zohoAccessToken(ctx)
  const res   = await emitirCuotaEnZoho(db, ctx, token, facturaId)
  if (!res.ok) throw new Error(res.error || 'No se pudo emitir la factura')
  return { ok: true, numero: res.numero, zoho: res.zoho, mensaje: `Factura ${res.numero} emitida en Zoho ✓` }
}

export async function emitirCuotaEnZoho(
  db: any,
  ctx: ZohoCtx,
  accessToken: string,
  filaId: string,
): Promise<{ ok: boolean; numero?: string; zoho?: string; error?: string }> {
  const { data: fila } = await db.from('mant_facturas').select('*').eq('id', filaId).single()
  if (!fila) return { ok: false, error: 'No se encontró el cobro' }
  if (fila.zoho_invoice_id) {
    return { ok: true, numero: fila.numero_serie, zoho: fila.zoho_invoice_number }
  }
  if (fila.estado !== 'pagada') {
    return { ok: false, error: 'Solo se factura una cuota efectivamente cobrada.' }
  }

  const { data: cfg } = await db.from('mant_config').select('*').eq('id', true).single()
  const { data: sede } = fila.local_id
    ? await db.from('locales').select('id,nombre,plan,cliente_id').eq('id', fila.local_id).maybeSingle()
    : { data: null }
  const { data: cliSede } = sede?.cliente_id
    ? await db.from('clientes').select('id,nombre,zoho_id').eq('id', sede.cliente_id).maybeSingle()
    : { data: null }

  // El cliente puede venir de la sede o directamente de la fila (sedes sueltas).
  let zohoCustomerId: string | null = cliSede?.zoho_id ?? null
  if (!zohoCustomerId && fila.cliente_id) {
    const { data: cli } = await db.from('clientes').select('zoho_id').eq('id', fila.cliente_id).maybeSingle()
    zohoCustomerId = cli?.zoho_id ?? null
  }
  if (!zohoCustomerId) {
    const error = 'El cliente no tiene ficha en Zoho Books. Sincroniza el cliente y vuelve a intentarlo.'
    await db.from('mant_facturas').update({ zoho_estado: 'error', zoho_error: error }).eq('id', filaId)
    return { ok: false, error }
  }

  // Porcentaje del impuesto: se cachea en `mant_config` porque hace falta para
  // sacar la base imponible desde el total cobrado y no cambia casi nunca.
  let taxPercent = cfg?.zoho_tax_percent
  if (cfg?.zoho_tax_id && (taxPercent === null || taxPercent === undefined)) {
    taxPercent = await fetchTaxPercent(ctx, accessToken, cfg.zoho_tax_id)
    if (taxPercent !== null) await db.from('mant_config').update({ zoho_tax_percent: taxPercent }).eq('id', true)
  }

  const plan = fila.plan || sede?.plan || ''
  const { data: planRow } = plan
    ? await db.from('planes_mantenimiento').select('zoho_item_id').eq('nombre', plan).maybeSingle()
    : { data: null }

  // El número se reserva lo más tarde posible: así un fallo anterior (cliente
  // sin Zoho, token caducado) no gasta un número de la serie.
  const fechaEmision = fila.fecha_emision || (fila.created_at || new Date().toISOString()).slice(0, 10)
  const numero = fila.numero_serie || await reservarNumeroSerie(db, fechaEmision)
  if (!fila.numero_serie) await db.from('mant_facturas').update({ numero_serie: numero }).eq('id', filaId)

  const periodo = fila.periodo_inicio && fila.periodo_fin
    ? ` (${fechaEs(fila.periodo_inicio)} – ${fechaEs(fila.periodo_fin)})`
    : ''

  try {
    const res = await crearFacturaMantenimiento({
      ctx, accessToken,
      zohoCustomerId,
      numeroSerie: numero,
      fecha: fechaEmision,
      lineas: [{
        descripcion: `Mantenimiento ${plan}${sede?.nombre ? ` · ${sede.nombre}` : ''}${periodo}`.trim(),
        cantidad: 1,
        importe: Number(fila.importe) || 0,
      }],
      config: {
        zoho_tax_id: cfg?.zoho_tax_id ?? null,
        enviar_factura_email: cfg?.enviar_factura_email ?? true,
        zoho_tax_percent: taxPercent ?? null,
        zoho_cuenta_cobro_id: cfg?.zoho_cuenta_cobro_id ?? null,
        zoho_notas: cfg?.zoho_notas ?? null,
      },
      referencia: fila.stripe_invoice_id || null,
      // Lo que Stripe descontó de un abono anterior: se aplica contra esta
      // factura en vez de registrarse como dinero que nunca entró.
      saldoAplicado: Number(fila.saldo_aplicado || 0),
      itemId: planRow?.zoho_item_id ?? null,
      notas: 'Cuota de mantenimiento cobrada por Stripe (tarjeta o domiciliación SEPA).',
    })

    await db.from('mant_facturas').update({
      zoho_invoice_id: res.zoho_invoice_id,
      zoho_invoice_number: res.zoho_invoice_number,
      zoho_estado: res.pagada ? 'pagada' : 'creada',
      zoho_error: res.aviso ?? null,
      zoho_at: new Date().toISOString(),
      base_imponible: Math.round(res.base * 100) / 100,
      impuesto: Math.round(res.impuesto * 100) / 100,
      email_enviado_at: res.email_enviado ? new Date().toISOString() : null,
      email_destinatarios: res.destinatarios.length ? res.destinatarios : null,
    }).eq('id', filaId)

    return { ok: true, numero, zoho: res.zoho_invoice_number }
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 1000)
    await db.from('mant_facturas').update({ zoho_estado: 'error', zoho_error: error }).eq('id', filaId)
    return { ok: false, error }
  }
}

// El año de la serie es el de la FECHA DE EMISIÓN, no el del reloj: una cuota
// cobrada el 30/12 y emitida (o reemitida) el 2/1 iba a MANT-2027 con fecha 2026.
async function reservarNumeroSerie(db: any, fecha: string): Promise<string> {
  const anio = Number(String(fecha || '').slice(0, 4)) || new Date().getFullYear()
  const { data, error } = await db.rpc('siguiente_numero_mant', { p_anio: anio })
  if (error || !data) throw new Error(`No se pudo reservar el número de serie: ${error?.message || 'sin respuesta'}`)
  return data as string
}

function fechaEs(iso: string): string {
  const [a, m, d] = String(iso).split('-')
  return `${d}/${m}/${a}`
}
