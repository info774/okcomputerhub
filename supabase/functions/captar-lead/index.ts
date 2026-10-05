// ════════════════════════════════════════════════════════════════════════
// captar-lead — captación de leads por agencias comerciales, portada de la
// app (paridad bloque 8, tanda 3) con sus mismas reglas. Endpoint PÚBLICO (va
// en SIN_JWT): lo usan comerciales externos desde public/captacion.html, sin
// cuenta en el hub. El envío exige identificarse con Google: llega el ID
// token de Google Identity Services y se verifica contra Google (audiencia =
// el client_id de la empresa, el MISMO de la app). Solo inserta una
// oportunidad «Detectado», origen «visita_comercial», en hub.oportunidades.
//   POST {credential, agencia?, local, direccion, telefono, contacto?,
//         productos[], otro?, notas?}
// Anti-abuso: honeypot (`web` vacío), límites de longitud, límite por IP y,
// opcional, el secret CAPTACION_ALLOWED_EMAILS (correos o @dominios).
// PREPARADA SIN CONECTAR (decisión de Fran, 2026-10-05): los comerciales
// siguen usando la página de la app. Para pasar a la del hub
// (https://okhub-tenerife.web.app/captacion.html) hay que añadir ese origen a
// los «Orígenes de JavaScript autorizados» del cliente OAuth (PENDIENTE_FRAN).
// ════════════════════════════════════════════════════════════════════════
import { makeCorsHeaders } from '../_shared/http.ts'
import { hubDb } from '../_shared/hub-db.ts'

// Público (es el mismo que ve cualquier visitante en el frontend).
const GOOGLE_CLIENT_ID = "508620194342-dahlc0qme0efch0os5tvr63u8jhkcbbn.apps.googleusercontent.com"

const PRODUCTOS_VALIDOS = ["TPV", "Alarmas", "Videovigilancia", "Inteligencia artificial", "Otro"]

// Límite de envíos por IP (por isolate; suficiente contra abuso casual).
const RATE_MAX = 20
const RATE_WINDOW_MS = 60 * 60 * 1000
const hits = new Map<string, number[]>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS)
  if (list.length >= RATE_MAX) { hits.set(ip, list); return true }
  list.push(now); hits.set(ip, list)
  return false
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max)

// Verifica el ID token de Google (firma y caducidad las valida Google en
// tokeninfo; aquí se comprueba además audiencia y correo verificado).
async function verifyGoogleToken(credential: string): Promise<{ email: string; name: string } | null> {
  if (!credential || credential.length > 4096) return null
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`)
  if (!res.ok) return null
  const info = await res.json().catch(() => null)
  if (!info || info.aud !== GOOGLE_CLIENT_ID || info.email_verified !== "true" || !info.email) return null
  return { email: String(info.email).toLowerCase(), name: String(info.name ?? info.email) }
}

function emailPermitido(email: string): boolean {
  const lista = (Deno.env.get("CAPTACION_ALLOWED_EMAILS") ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!lista.length) return true
  return lista.some(e => e.startsWith("@") ? email.endsWith(e) : email === e)
}

Deno.serve(async (req: Request) => {
  const cors = makeCorsHeaders(req)
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405, cors)

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json({ error: "Petición inválida." }, 400, cors)

    // Honeypot: los humanos no ven este campo; si viene relleno es un bot.
    if (clean(body.web, 10)) return json({ ok: true }, 200, cors)

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?"
    if (rateLimited(ip)) return json({ error: "Demasiados envíos. Espera un rato e inténtalo de nuevo." }, 429, cors)

    const quien = await verifyGoogleToken(String(body.credential ?? ""))
    if (!quien) return json({ error: "Tu acceso ha caducado o no es válido. Vuelve a identificarte con Google." }, 401, cors)
    if (!emailPermitido(quien.email)) return json({ error: "Esta cuenta de Google no está autorizada para enviar clientes. Contacta con OK Computer Tenerife." }, 403, cors)

    const agencia   = clean(body.agencia, 120)
    const local     = clean(body.local, 160)
    const direccion = clean(body.direccion, 240)
    const telefono  = clean(body.telefono, 40)
    const contacto  = clean(body.contacto, 120)
    const otro      = clean(body.otro, 160)
    const notas     = clean(body.notas, 1500)
    const productos = (Array.isArray(body.productos) ? body.productos : [])
      .map(p => clean(p, 40)).filter(p => PRODUCTOS_VALIDOS.includes(p))

    if (local.length < 2)     return json({ error: "Indica el nombre del local." }, 400, cors)
    if (direccion.length < 4) return json({ error: "Indica la dirección del local." }, 400, cors)
    if (telefono.replace(/\D/g, "").length < 7) return json({ error: "Indica un teléfono de contacto válido." }, 400, cors)
    if (!productos.length)    return json({ error: "Marca al menos un producto de interés." }, 400, cors)
    if (productos.includes("Otro") && !otro) return json({ error: "Indica cuál es el otro servicio de interés." }, 400, cors)

    const productosTxt = productos.map(p => p === "Otro" ? `Otro: ${otro}` : p).join(", ")
    const captadoPor = `${quien.name} (${quien.email})${agencia ? ` — ${agencia}` : ""}`
    const descripcion = [
      "Lead captado por agencia comercial (formulario de captación).",
      "",
      `Local: ${local}`,
      `Dirección: ${direccion}`,
      `Teléfono: ${telefono}`,
      contacto ? `Persona de contacto: ${contacto}` : null,
      `Interesado en: ${productosTxt}`,
      notas ? `Notas: ${notas}` : null,
      `Captado por: ${captadoPor}`,
    ].filter(l => l !== null).join("\n")

    try {
      await hubDb({ origen: "captar-lead" }).post("oportunidades", {
        titulo: `${local} · ${productos.includes("Otro") && productos.length === 1 ? otro : productos.join(", ")}`.slice(0, 200),
        descripcion,
        estado: "Detectado",
        origen: "visita_comercial",
      })
    } catch (e) {
      console.error("captar-lead insert error", e)
      return json({ error: "No se pudo guardar el cliente. Inténtalo de nuevo." }, 500, cors)
    }
    return json({ ok: true }, 200, cors)
  } catch (e) {
    console.error("captar-lead", e)
    return json({ error: "Error interno." }, 500, cors)
  }
})
