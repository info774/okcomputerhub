// firma-contrato — firma telemática de los contratos de mantenimiento
// (portada de la función del mismo nombre de la app). PÚBLICA (SIN_JWT): la
// usa el cliente sin sesión desde contrato.html?token=…; la autoriza el token
// del enlace. Lee y escribe hub.contratos con la service key.
//   { accion: 'ver', token }    → el documento y su estado
//   { accion: 'firmar', token, firmante_nombre, firma_img, acepta }
//   { accion: 'pagar', token, metodo }  → primera cuota (Stripe: aún NO
//     conectado en el hub; contesta 409 hasta el corte de mantenimiento)
// Reglas de la app: solo se firma lo PENDIENTE (no se refirma ni se firma lo
// anulado), con nombre (≥ 3), firma dibujada (PNG, ≤ 800 000 caracteres) y la
// casilla aceptada; queda la evidencia (fecha, IP y navegador). Al firmar, las
// condiciones bajan a la sede (plan, cuota NETA, frecuencia) salvo que ya se
// esté cobrando (Stripe con mandato o la Zoho Billing vieja viva).
// Mientras el área `mantenimiento` sea de la app, aquí no se firma nada: los
// enlaces que se mandan a los clientes son los de la app.
import { makeCorsHeaders, json } from '../_shared/http.ts'
import { hubDb, type Db, type Fila } from '../_shared/hub-db.ts'

const ZOHO_MUERTA = new Set(['cancelled', 'expired', 'cancelled_from_dunning', 'no_existe'])
const sinAcentos = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const FRECUENCIAS = ['Mensual', 'Trimestral', 'Semestral', 'Anual']
const normalizaFrecuencia = (f: unknown) => FRECUENCIAS.find(k => k.toLowerCase() === String(f ?? '').trim().toLowerCase()) ?? null
const zohoSigueCobrando = (l: Fila) => !!l.zoho_subscription_id && !l.stripe_subscription_id && !ZOHO_MUERTA.has(sinAcentos(l.zoho_estado))
const cobrandoStripe = (l: Fila) => !!l.stripe_subscription_id && l.stripe_mandato_estado === 'activo'
const tokenValido = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t)

async function delHub(db: Db, tabla: string): Promise<boolean> {
  const [a] = await db.get(`areas?select=dueno&tablas=cs.{${tabla}}&limit=1`)
  return (a?.dueno ?? 'hub') === 'hub'
}

// volcarCondiciones de la app: el contrato firmado es la fuente buena de plan,
// cuota (neta) y frecuencia de su sede. Best-effort: la firma ya está guardada.
async function volcarCondiciones(db: Db, c: Fila): Promise<void> {
  if (!c.local_id || !c.plan_nombre || !(await delHub(db, 'locales'))) return
  const [sede] = await db.get(`locales?select=id,stripe_subscription_id,stripe_mandato_estado,zoho_subscription_id,zoho_estado,frecuencia_pago&id=eq.${c.local_id}`)
  if (!sede || zohoSigueCobrando(sede) || cobrandoStripe(sede)) return
  const cambios: Fila = { plan: c.plan_nombre }
  if (c.precio_mensual != null) { cambios.importe_mantenimiento = c.precio_mensual; cambios.importe_incluye_impuesto = false }
  cambios.frecuencia_pago = normalizaFrecuencia(c.frecuencia_pago) ?? normalizaFrecuencia(sede.frecuencia_pago) ?? 'Mensual'
  await db.patch(`locales?id=eq.${c.local_id}`, cambios)
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405, cors)
  const b = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!b) return json({ error: 'Petición inválida.' }, 400, cors)
  if (!tokenValido(b.token)) return json({ error: 'Este enlace de firma no es correcto.' }, 400, cors)
  const db = hubDb({ origen: 'firma-contrato' })
  try {
    const [c] = await db.get(`contratos?token=eq.${b.token}&select=id,estado,local_id,cliente_id,precio_mensual,plan_nombre,frecuencia_pago,mandato_estado,cliente_nombre,cuerpo_html,firmante_nombre,firmado_at`)
    if (!c) return json({ error: 'Contrato no encontrado.' }, 404, cors)

    if (b.accion === 'ver') {
      const { cuerpo_html, plan_nombre, cliente_nombre, estado, firmante_nombre, firmado_at } = c
      // El pago tras firmar llega con el motor de Stripe (sin conectar todavía).
      return json({ contrato: { cuerpo_html, plan_nombre, cliente_nombre, estado, firmante_nombre, firmado_at }, pago: null }, 200, cors)
    }

    if (b.accion === 'pagar') {
      return json({ error: 'El pago en línea todavía no está disponible: te mandaremos el enlace para pagar la cuota.', no_activo: true }, 409, cors)
    }

    if (b.accion !== 'firmar') return json({ error: 'Acción desconocida (ver, firmar, pagar).' }, 400, cors)
    if (!(await delHub(db, 'contratos'))) return json({ error: 'Este contrato se firma desde el enlace que te mandamos.' }, 409, cors)
    const nombre = String(b.firmante_nombre ?? '').trim().slice(0, 150)
    const firma = String(b.firma_img ?? '')
    if (b.acepta !== true) return json({ error: 'Debes aceptar el contrato para firmar.' }, 400, cors)
    if (nombre.length < 3) return json({ error: 'Indica tu nombre y apellidos.' }, 400, cors)
    if (!/^data:image\/png;base64,/.test(firma)) return json({ error: 'Falta la firma dibujada.' }, 400, cors)
    if (firma.length > 800_000) return json({ error: 'La firma es demasiado grande.' }, 400, cors)
    if (c.estado !== 'pendiente') return json({ error: 'Este contrato ya no está disponible para firma.', estado: c.estado }, 409, cors)

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
    const hechos = await db.patch(`contratos?token=eq.${b.token}&estado=eq.pendiente`, {
      estado: 'firmado', firmante_nombre: nombre, firma_img: firma, firmado_at: new Date().toISOString(),
      firmante_ip: ip, firmante_user_agent: (req.headers.get('user-agent') ?? '').slice(0, 500) || null,
    })
    if (!hechos.length) return json({ error: 'No se pudo registrar la firma.' }, 409, cors)
    await volcarCondiciones(db, c).catch(e => console.warn('[firma-contrato] no se pudieron volcar las condiciones:', (e as Error).message))
    return json({ ok: true, pago: null }, 200, cors)
  } catch (e) {
    console.error('[firma-contrato]', (e as Error).message)
    return json({ error: 'Error interno.' }, 500, cors)
  }
})
