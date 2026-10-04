// Portado de la app (_shared/zoho-abono-mant.ts, paridad bloque 4, tanda 3).
// Cambios: Zoho del hub (zoho-ctx.ts) y sin «embeds» (el espejo no tiene
// claves foráneas).
// Abonos (facturas rectificativas) de las cuotas de mantenimiento, en Zoho
// Books y en su SERIE PROPIA (ABONO-AAAA-NNNN).
//
// Una factura emitida no se toca: es el registro fiscal de un cobro que ocurrió
// de verdad. Lo que corrige un importe cobrado de más es otro documento, que la
// referencia. Por eso esto no modifica nada de `mant_facturas`, solo añade.
//
// Qué NO hace y por qué:
//   · No aplica el abono contra la factura que rectifica. Esa factura ya está
//     cobrada al completo (el circuito registra el pago al emitirla), así que no
//     hay saldo contra el que aplicarlo: Zoho lo rechazaría. El abono queda como
//     CRÉDITO del cliente, que es exactamente lo que se le da también en Stripe.
//   · No devuelve dinero al banco. El acuerdo es saldo a favor: se descuenta
//     solo de la cuota siguiente. La devolución de un adeudo SEPA ya liquidado
//     es otra operación y se hace a conciencia, no desde un botón.
//
// El enlace con la factura rectificada va en `reference_number` y en la
// descripción de la línea, para que en Zoho se vea de un vistazo a qué
// corresponde.

import { type ZohoCtx, zohoCtx, zohoAccessToken } from './zoho-ctx.ts'
import { baseImponible } from './mant-importes.ts'

export interface ResultadoAbono {
  zoho_creditnote_id: string
  zoho_creditnote_number: string
  base: number
  impuesto: number
  aviso?: string
}

// Crea el abono en Zoho Books. El importe que entra es el TOTAL con impuesto
// (el dinero que se le devuelve al cliente) y la base se deriva de ahí, igual
// que en las facturas: así el abono suma exactamente lo que se descuenta.
export async function crearAbonoEnZoho(opts: {
  ctx: ZohoCtx
  accessToken: string
  zohoCustomerId: string
  numeroSerie: string
  fecha: string                  // 'YYYY-MM-DD'
  descripcion: string
  importe: number                // total con impuesto
  taxId: string | null
  taxPercent: number | null
  facturaNumero?: string | null  // el número de la factura que rectifica
  itemId?: string | null
  notas?: string | null
}): Promise<ResultadoAbono> {
  const { ctx, accessToken, zohoCustomerId, numeroSerie, fecha, importe } = opts
  const { ZOHO_ORG_ID, apiDomain } = ctx

  const taxPct = opts.taxId ? (opts.taxPercent ?? 0) : 0
  const base   = baseImponible(importe, taxPct)

  const linea: Record<string, unknown> = {
    description: opts.descripcion,
    quantity: 1,
    // Cuatro decimales, como en la factura: truncar a dos desvía el total unos
    // céntimos y el abono dejaría de cuadrar con lo que se descuenta.
    rate: Math.round(base * 10000) / 10000,
  }
  if (opts.itemId) linea.item_id = opts.itemId
  if (opts.taxId)  linea.tax_id  = opts.taxId

  const payload: Record<string, unknown> = {
    customer_id: zohoCustomerId,
    creditnote_number: numeroSerie,
    date: fecha,
    line_items: [linea],
  }
  // La factura que rectifica, a la vista en el documento.
  if (opts.facturaNumero) payload.reference_number = opts.facturaNumero
  if (opts.notas) payload.notes = opts.notas

  // `ignore_auto_number_generation=true` es lo que hace que Zoho respete
  // NUESTRO número en vez de pisarlo con el de su secuencia.
  const res = await fetch(
    `https://${apiDomain}/books/v3/creditnotes?organization_id=${ZOHO_ORG_ID}&ignore_auto_number_generation=true`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
  const data = await res.json().catch(() => ({}))
  if (data.code !== 0) {
    throw new Error(`Zoho: ${data.message || 'no se pudo crear el abono'}`)
  }

  const id     = data.creditnote?.creditnote_id as string
  const numero = (data.creditnote?.creditnote_number as string) || numeroSerie
  const total  = Number(data.creditnote?.total ?? 0)

  // Misma red de seguridad que en las facturas: si Zoho no suma lo que vamos a
  // descontar, el impuesto configurado no es el que se usó y hay que verlo
  // ahora. No se aborta —el documento ya existe— pero queda escrito.
  let aviso: string | undefined
  if (Math.abs(total - importe) > 0.02) {
    aviso = `Descuadre: se abonan ${importe.toFixed(2)} € y el documento de Zoho suma ${total.toFixed(2)} €.`
  }

  // Sacarlo de borrador. Un abono en borrador no cuenta como emitido ni genera
  // crédito para el cliente. Si falla no se aborta: el documento existe y el
  // aviso sube a `mant_abonos.zoho_error`.
  const abrir = await fetch(
    `https://${apiDomain}/books/v3/creditnotes/${id}/status/open?organization_id=${ZOHO_ORG_ID}`,
    { method: 'POST', headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } },
  )
  const abrirData = await abrir.json().catch(() => ({}))
  if (abrirData.code !== 0) {
    aviso = [aviso, `No se pudo abrir el abono (queda en borrador): ${abrirData.message || abrir.status}`]
      .filter(Boolean).join(' · ')
  }

  return {
    zoho_creditnote_id: id,
    zoho_creditnote_number: numero,
    base: Number(data.creditnote?.sub_total ?? base),
    impuesto: Number(data.creditnote?.tax_total ?? (importe - base)),
    aviso,
  }
}

// ── Crédito disponible del cliente ──────────────────────────────────────────
// Los abonos emitidos y sin aplicar. La emisión de la cuota siguiente los usa
// para aplicar contra ella lo que Stripe ya descontó como saldo, de forma que
// el crédito no se quede colgado en Zoho para siempre.
export async function creditosAbiertos(
  ctx: ZohoCtx, accessToken: string, zohoCustomerId: string,
): Promise<{ id: string; numero: string; saldo: number }[]> {
  const url = `https://${ctx.apiDomain}/books/v3/creditnotes`
    + `?organization_id=${ctx.ZOHO_ORG_ID}&customer_id=${encodeURIComponent(zohoCustomerId)}`
    + `&filter_by=Status.Open&per_page=200`
  const res  = await fetch(url, { headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } })
  const data = await res.json().catch(() => ({}))
  if (data.code !== 0) return []
  return (Array.isArray(data.creditnotes) ? data.creditnotes : [])
    .map((c: any) => ({
      id: String(c.creditnote_id),
      numero: String(c.creditnote_number || ''),
      saldo: Number(c.balance ?? c.total ?? 0),
    }))
    .filter((c: { saldo: number }) => c.saldo > 0)
}

// Aplica crédito del cliente contra una factura recién emitida, hasta cubrir
// `importe`. Devuelve lo que realmente se aplicó.
//
// Nunca lanza: que el crédito no se aplique deja los libros descuadrados, pero
// deshacer una factura ya emitida por eso sería peor. El motivo vuelve como
// aviso y acaba a la vista en la app.
export async function aplicarCreditoAFactura(
  ctx: ZohoCtx, accessToken: string, zohoCustomerId: string,
  zohoInvoiceId: string, importe: number,
): Promise<{ aplicado: number; aviso?: string }> {
  if (importe <= 0.005) return { aplicado: 0 }
  try {
    const creditos = await creditosAbiertos(ctx, accessToken, zohoCustomerId)
    if (!creditos.length) {
      return { aplicado: 0, aviso: `Stripe descontó ${importe.toFixed(2)} € de saldo pero en Zoho no hay abonos abiertos que aplicar.` }
    }

    // Se reparte entre los abonos disponibles, de más antiguo a más nuevo.
    const usar: { creditnote_id: string; amount_applied: number }[] = []
    let queda = Math.round(importe * 100) / 100
    for (const c of creditos) {
      if (queda <= 0.005) break
      const cuanto = Math.min(c.saldo, queda)
      usar.push({ creditnote_id: c.id, amount_applied: Math.round(cuanto * 100) / 100 })
      queda = Math.round((queda - cuanto) * 100) / 100
    }
    if (!usar.length) return { aplicado: 0 }

    // Se aplica abono a abono: el endpoint cuelga de la nota de crédito.
    let aplicado = 0
    const fallos: string[] = []
    for (const u of usar) {
      const res = await fetch(
        `https://${ctx.apiDomain}/books/v3/creditnotes/${u.creditnote_id}/invoices?organization_id=${ctx.ZOHO_ORG_ID}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ invoices: [{ invoice_id: zohoInvoiceId, amount_applied: u.amount_applied }] }),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (data.code === 0) aplicado += u.amount_applied
      else fallos.push(data.message || `HTTP ${res.status}`)
    }

    const sobra = Math.round((importe - aplicado) * 100) / 100
    const aviso = fallos.length || sobra > 0.005
      ? `Saldo aplicado en Zoho: ${aplicado.toFixed(2)} € de ${importe.toFixed(2)} €.`
        + (fallos.length ? ` ${fallos.join(' · ')}` : '')
      : undefined
    return { aplicado, aviso }
  } catch (e: any) {
    return { aplicado: 0, aviso: `No se pudo aplicar el saldo en Zoho: ${e?.message || e}` }
  }
}

// ── Emisión de un abono desde la app ────────────────────────────────────────
// La llama `stripe-suscripcion` (acción `abonar`). Hace las tres cosas en el
// orden que deja menos estropicio si algo falla por medio:
//   1. Comprueba y reserva. Sin factura emitida en Zoho no hay nada que
//      rectificar, y no se puede abonar más de lo que se cobró.
//   2. Emite el documento fiscal en Zoho.
//   3. Le da el saldo a favor en Stripe.
// Si (3) falla, el abono existe y queda marcado: se reintenta desde la app sin
// volver a quemar un número de serie ni emitir el documento dos veces.
export async function emitirAbono(
  db: any,
  darSaldoStripe: (customerId: string, centimos: number, descripcion: string) => Promise<string>,
  body: { factura_id?: string; importe?: number | string; motivo?: string },
  usuario?: string | null,
) {
  if (!body.factura_id) throw new Error('Falta la cuota que se quiere abonar')
  const motivo = String(body.motivo || '').trim()
  if (!motivo) throw new Error('Pon el motivo del abono: es lo que explica el documento dentro de seis meses.')

  const { data: fila } = await db.from('mant_facturas').select('*').eq('id', body.factura_id).single()
  if (!fila) throw new Error('No se encontró la cuota')
  if (!fila.zoho_invoice_id) {
    throw new Error('Esa cuota todavía no está facturada en Zoho: no hay nada que rectificar. '
      + 'Emítela primero («Emitir en Zoho») y luego abona.')
  }

  const { data: yaAbonado } = await db.from('mant_facturas_abonadas')
    .select('abonado,abonable').eq('factura_id', fila.id).maybeSingle()
  const abonable = Number(yaAbonado?.abonable ?? fila.importe)

  const importe = Math.round(Number(body.importe) * 100) / 100
  if (!importe || importe <= 0) throw new Error('El importe del abono tiene que ser mayor que cero')
  if (importe > abonable + 0.005) {
    throw new Error(`No se puede abonar ${importe.toFixed(2)} €: de esa cuota quedan ${abonable.toFixed(2)} € por abonar `
      + `(se cobraron ${Number(fila.importe).toFixed(2)} €).`)
  }

  const { data: cfg } = await db.from('mant_config').select('*').eq('id', true).single()

  // Cliente en Zoho: de la sede o de la propia fila (sedes sueltas).
  const { data: sedeFila } = fila.local_id
    ? await db.from('locales').select('id,nombre,plan,cliente_id').eq('id', fila.local_id).maybeSingle()
    : { data: null }
  const { data: cliSede } = sedeFila?.cliente_id
    ? await db.from('clientes').select('id,nombre,zoho_id,stripe_customer_id').eq('id', sedeFila.cliente_id).maybeSingle()
    : { data: null }
  const sede = sedeFila ? { ...sedeFila, clientes: cliSede } : null
  let zohoCustomerId: string | null = sede?.clientes?.zoho_id ?? null
  if (!zohoCustomerId && fila.cliente_id) {
    const { data: cli } = await db.from('clientes').select('zoho_id').eq('id', fila.cliente_id).maybeSingle()
    zohoCustomerId = cli?.zoho_id ?? null
  }
  if (!zohoCustomerId) throw new Error('El cliente no tiene ficha en Zoho Books. Sincronízalo y vuelve a intentarlo.')

  const hoy = new Date().toISOString().slice(0, 10)
  const ctx   = zohoCtx()
  const token = await zohoAccessToken(ctx)

  // El número se reserva lo más tarde posible: un fallo anterior no gasta uno.
  const { data: numero, error: errNum } = await db.rpc('siguiente_numero_abono', { p_anio: Number(hoy.slice(0, 4)) })
  if (errNum || !numero) throw new Error(`No se pudo reservar el número del abono: ${errNum?.message || 'sin respuesta'}`)

  const { data: abono, error: errIns } = await db.from('mant_abonos').insert({
    factura_id: fila.id,
    local_id: fila.local_id,
    cliente_id: fila.cliente_id,
    numero_serie: numero,
    motivo,
    fecha_emision: hoy,
    importe,
    moneda: fila.moneda || 'eur',
    creado_por: usuario || null,
  }).select('id').single()
  if (errIns) throw new Error(`No se pudo registrar el abono: ${errIns.message}`)

  const descripcion = `Abono de la cuota ${fila.numero_serie || ''} · ${motivo}`.trim()

  let zoho: any
  try {
    zoho = await crearAbonoEnZoho({
      ctx, accessToken: token,
      zohoCustomerId,
      numeroSerie: numero,
      fecha: hoy,
      descripcion,
      importe,
      taxId: cfg?.zoho_tax_id ?? null,
      taxPercent: cfg?.zoho_tax_percent ?? null,
      facturaNumero: fila.zoho_invoice_number || fila.numero_serie || null,
      notas: `Rectifica la factura ${fila.zoho_invoice_number || fila.numero_serie}. `
        + 'El importe queda como saldo a favor y se descuenta de la cuota siguiente.',
    })
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 1000)
    await db.from('mant_abonos').update({ zoho_estado: 'error', zoho_error: error }).eq('id', abono.id)
    throw new Error(`No se pudo emitir el abono en Zoho: ${error}`)
  }

  await db.from('mant_abonos').update({
    zoho_creditnote_id: zoho.zoho_creditnote_id,
    zoho_creditnote_number: zoho.zoho_creditnote_number,
    zoho_estado: 'emitido',
    zoho_error: zoho.aviso ?? null,
    zoho_at: new Date().toISOString(),
    base_imponible: Math.round(zoho.base * 100) / 100,
    impuesto: Math.round(zoho.impuesto * 100) / 100,
  }).eq('id', abono.id)

  // ── Saldo a favor en Stripe ───────────────────────────────────────────────
  // Va al final: el documento fiscal ya existe, y si esto falla se reintenta
  // sin duplicar nada. Un saldo sin abono sería peor que un abono sin saldo.
  const customerId = sede?.clientes?.stripe_customer_id || fila.stripe_customer_id || null
  let stripeAviso: string | null = null
  if (!customerId) {
    stripeAviso = 'El abono está emitido, pero la sede no tiene cliente en Stripe: el saldo hay que dárselo a mano.'
  } else {
    try {
      const txn = await darSaldoStripe(customerId, Math.round(importe * 100), `${numero} · ${motivo}`)
      await db.from('mant_abonos').update({ stripe_balance_txn_id: txn, stripe_error: null }).eq('id', abono.id)
    } catch (e: any) {
      stripeAviso = `Abono emitido, pero no se pudo dar el saldo en Stripe: ${String(e?.message || e)}`
      await db.from('mant_abonos').update({ stripe_error: stripeAviso.slice(0, 500) }).eq('id', abono.id)
    }
  }

  return {
    ok: true,
    numero,
    zoho: zoho.zoho_creditnote_number,
    importe,
    aviso: [zoho.aviso, stripeAviso].filter(Boolean).join(' · ') || null,
    mensaje: `Abono ${numero} emitido por ${importe.toFixed(2)} € ✓`
      + (stripeAviso ? '' : ' Se descontará de la cuota siguiente.'),
  }
}
