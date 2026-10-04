// Portado literal de la app (_shared/mant-importes.ts, paridad bloque 4, tanda 3).
// Aritmética de la cuota de mantenimiento: céntimos, impuestos y periodos.
//
// Es independiente del proveedor de cobro a propósito: la regla que sostiene el
// circuito (los precios de la app son NETOS, al cliente se le cobra el precio
// MÁS el impuesto, y la factura de Zoho se emite por lo cobrado) no depende de
// quién pase el recibo. Por eso vive aparte de `stripe.ts`, de donde salió.

// Stripe trabaja en la unidad mínima de la moneda: céntimos.
// Redondear al pasar de euros a céntimos evita que 49.99 acabe en 4998 por el
// error de coma flotante.
export function aCentimos(euros: number): number {
  return Math.round(Number(euros) * 100)
}
export function aEuros(centimos: number): number {
  return Math.round(Number(centimos)) / 100
}

// ── Precio del plan ⇄ importe que se cobra ──────────────────────────────────
// Los precios de la app (`planes_mantenimiento.precio_mensual`,
// `locales.importe_mantenimiento`) son NETOS por defecto: la base imponible.
// Al cliente hay que cobrarle la base MÁS el impuesto, porque la factura de Zoho
// se emite por el dinero que entró de verdad. Si se cobrase solo la base, la
// factura sumaría el impuesto encima y nunca cuadraría con el cobro.
//
// Con `precioIncluyeImpuesto = true` el precio ya es el total y no se toca.
export function importeACobrar(
  precio: number, tipoImpuesto: number | null | undefined, precioIncluyeImpuesto: boolean,
): number {
  if (precioIncluyeImpuesto) return Number(precio)
  return Number(precio) * (1 + (Number(tipoImpuesto) || 0) / 100)
}

// El camino de vuelta: de lo cobrado al precio que enseña la app.
export function precioDesdeCobro(
  totalCobrado: number, tipoImpuesto: number | null | undefined, precioIncluyeImpuesto: boolean,
): number {
  if (precioIncluyeImpuesto) return Number(totalCobrado)
  return Number(totalCobrado) / (1 + (Number(tipoImpuesto) || 0) / 100)
}

// Base imponible a partir del total cobrado. Es la misma cuenta en las dos
// configuraciones: la factura de Zoho SIEMPRE suma lo que se cobró, y lo único
// que cambia entre modos es cuánto se le manda cobrar al proveedor.
export function baseImponible(total: number, tipoImpuesto: number | null | undefined): number {
  return Number(total) / (1 + (Number(tipoImpuesto) || 0) / 100)
}

// ── La cuota NETA de una sede ───────────────────────────────────────────────
// `locales.importe_mantenimiento` es neto por convenio, salvo en la cartera que
// viene de Zoho Billing: allí el sync guarda `sub.amount`, que es lo que Zoho
// COBRABA, con el IGIC ya dentro. `importe_incluye_impuesto` marca cuáles
// (migración 20260919_importe_bruto_cartera_zoho.sql).
//
// Leerlas como netas y sumarles el impuesto otra vez es cobrar de más: le pasó
// a «Pizzeria GuGioCa» el 09/09/2026 (41,73 € guardados → 44,65 € cobrados,
// cuando lo pactado eran 39,00 € + IGIC). Por eso TODO camino que mande cobrar
// —alta, cambio de plan, primera cuota de la firma— pasa por aquí en vez de
// leer la columna a pelo.
export function importeNetoDeSede(
  local: { importe_mantenimiento?: number | string | null; importe_incluye_impuesto?: boolean | null } | null,
  cfg: { zoho_tax_percent?: number | null; precio_incluye_impuesto?: boolean | null },
): number {
  const guardado = Number(local?.importe_mantenimiento ?? 0)
  if (!guardado || !local?.importe_incluye_impuesto) return guardado
  const neto = precioDesdeCobro(guardado, cfg?.zoho_tax_percent, !!cfg?.precio_incluye_impuesto)
  return Math.round(neto * 100) / 100
}

// ── Frecuencia de pago ──────────────────────────────────────────────────────
// Cuántos meses cubre cada cuota. El importe de las frecuencias largas es el
// mensual multiplicado por los meses del periodo: es lo que se cobra de una
// vez, no un descuento por pago adelantado (si algún día lo hay, va aquí).
export const FRECUENCIAS_MESES: Record<string, number> = {
  'Mensual': 1,
  'Trimestral': 3,
  'Semestral': 6,
  'Anual': 12,
}

// La app escribe la frecuencia con mayúscula inicial ('Anual'), pero en la base
// hay filas viejas en minúscula: los desplegables llegaron a tener
// `value="anual"`. Buscarlas tal cual en el mapa no encontraba nada, se caía al
// mes por defecto y una cuota anual se cobraba TODOS los meses. Se normaliza en
// la puerta de entrada, que es por donde pasan los dos motores de cobro.
export function normalizaFrecuencia(frecuencia: string | null | undefined): string | null {
  const q = String(frecuencia ?? '').trim().toLowerCase()
  if (!q) return null
  return Object.keys(FRECUENCIAS_MESES).find((f) => f.toLowerCase() === q) ?? null
}

// ¿Es una frecuencia que sepamos cobrar? Sirve para parar un alta con una
// frecuencia inventada en vez de cobrarla mensual sin decir nada.
export function esFrecuenciaValida(frecuencia: string | null | undefined): boolean {
  return !frecuencia || normalizaFrecuencia(frecuencia) !== null
}

export function mesesDeFrecuencia(frecuencia: string | null | undefined): number {
  return FRECUENCIAS_MESES[normalizaFrecuencia(frecuencia) ?? 'Mensual'] ?? 1
}

// ── Fechas ──────────────────────────────────────────────────────────────────
// Todo en 'YYYY-MM-DD' (columnas `date`), calculado en UTC para que el periodo
// no baile con la hora local de la función.
export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}


// Suma meses a una fecha ISO conservando el día cuando existe y recortando al
// último del mes cuando no (31 de enero + 1 mes = 28/29 de febrero). Sin el
// recorte, `Date` desborda al mes siguiente y una cuota del día 31 acabaría
// cobrándose el 2 o el 3.
export function sumarMeses(fechaISO: string, meses: number): string {
  const [a, m, d] = fechaISO.split('-').map(Number)
  const base = new Date(Date.UTC(a, m - 1 + meses, 1))
  const ultimoDia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate()
  base.setUTCDate(Math.min(d, ultimoDia))
  return base.toISOString().slice(0, 10)
}

// Periodo que cubre una cuota que empieza en `inicio`.
export function periodoDesde(inicio: string, frecuencia: string | null | undefined) {
  return { inicio, fin: sumarMeses(inicio, mesesDeFrecuencia(frecuencia)) }
}
