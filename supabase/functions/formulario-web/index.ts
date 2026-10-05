// ════════════════════════════════════════════════════════════════════════
// formulario-web — el formulario de contacto/presupuesto de las WEBS PÚBLICAS
// (okcomputertenerife.com, tenerifetpv.es), portado de la app (paridad bloque
// 8, tanda 3) con sus mismas reglas. Endpoint PÚBLICO y SIN JWT (va en
// SIN_JWT de deploy-funciones.yml): lo llama el snippet incrustado en la web,
// sin sesión ni claves. Solo INSERTA una oportunidad «Detectado», origen
// «web», en hub.oportunidades (área del hub); no devuelve ni lee nada.
//   POST {sitio, nombre, negocio?, telefono?, email?, intereses[], mensaje?,
//         privacidad:true, pagina?, t, web}
// Anti-abuso: honeypot (`web` vacío), tiempo mínimo de relleno (`t`),
// límites de longitud y límite por IP. Cada web es una entrada de SITIOS
// (sus chips tienen que cuadrar al carácter con su snippet).
// PREPARADA SIN CONECTAR (decisión de Fran, 2026-10-05): las webs siguen
// mandando a la función de la app y sync-app copia la oportunidad. Conectar =
// pegar en cada web su snippet de docs/formularios-web/ (apunta aquí).
// ════════════════════════════════════════════════════════════════════════
import { hubDb } from '../_shared/hub-db.ts'

const INTERESES_OKC = ["TPV", "Alarma", "Cámaras", "Domótica", "Software a medida / IA", "Red / Wi-Fi", "Mantenimiento"]
const INTERESES_TPV = ["Un TPV nuevo", "Poner mi TPV al día con VeriFactu", "Cobro automático de efectivo",
  "Impresora, lector o báscula", "Wi-Fi y cableado del local", "Soporte y mantenimiento"]

// `etiqueta` va en el título de la oportunidad para saber de qué web vino.
const SITIOS: Record<string, { nombre: string; etiqueta: string; origenes: string[]; intereses: string[] }> = {
  "okcomputertenerife.com": {
    nombre: "okcomputertenerife.com",
    etiqueta: "Web",
    origenes: ["https://okcomputertenerife.com", "https://www.okcomputertenerife.com"],
    intereses: INTERESES_OKC,
  },
  "tenerifetpv.es": {
    nombre: "tenerifetpv.es (Tenerife TPV)",
    etiqueta: "Web TPV",
    origenes: ["https://tenerifetpv.es", "https://www.tenerifetpv.es"],
    intereses: INTERESES_TPV,
  },
}

// Menos de esto desde que se pintó el formulario no lo rellena una persona.
const TIEMPO_MIN_MS = 3000

const RATE_MAX = 5
const RATE_WINDOW_MS = 60 * 60 * 1000
const hits = new Map<string, number[]>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS)
  if (list.length >= RATE_MAX) { hits.set(ip, list); return true }
  list.push(now); hits.set(ip, list)
  return false
}

const LOCAL_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

function corsHeaders(req: Request): Record<string, string> {
  const extra = (Deno.env.get("FORMULARIO_WEB_ORIGINS") ?? "").split(",").map(s => s.trim()).filter(Boolean)
  const permitidos = [...Object.values(SITIOS).flatMap(s => s.origenes), ...extra]
  const origin = req.headers.get("Origin") ?? ""
  const h: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  }
  if (permitidos.includes(origin) || LOCAL_RE.test(origin)) h["Access-Control-Allow-Origin"] = origin
  else if (origin) console.warn(`[formulario-web] origen no permitido: ${origin}`)
  return h
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max)

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req)
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405, cors)

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json({ error: "Petición inválida." }, 400, cors)

    // Bots: se les contesta «ok» para que no insistan con otra variante.
    if (clean(body.web, 10)) return json({ ok: true }, 200, cors)
    const t = Number(body.t)
    if (!Number.isFinite(t) || t < TIEMPO_MIN_MS) return json({ ok: true }, 200, cors)

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?"
    if (rateLimited(ip)) return json({ error: "Demasiados envíos seguidos. Llámanos al 922 71 73 90." }, 429, cors)

    const sitio = SITIOS[clean(body.sitio, 80)]
    if (!sitio) return json({ error: "Formulario no reconocido." }, 400, cors)

    const nombre   = clean(body.nombre, 120)
    const negocio  = clean(body.negocio, 160)
    const telefono = clean(body.telefono, 40)
    const email    = clean(body.email, 160).toLowerCase()
    const mensaje  = clean(body.mensaje, 3000)
    const pagina   = clean(body.pagina, 300)
    const intereses = [...new Set((Array.isArray(body.intereses) ? body.intereses : [])
      .map(p => clean(p, 60)).filter(p => sitio.intereses.includes(p)))]

    const telOk   = telefono.replace(/\D/g, "").length >= 9
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
    if (nombre.length < 2) return json({ error: "Indica tu nombre." }, 400, cors)
    if (!telOk && !emailOk) return json({ error: "Déjanos un teléfono o un email para responderte." }, 400, cors)
    if (telefono && !telOk) return json({ error: "Revisa el teléfono." }, 400, cors)
    if (email && !emailOk)  return json({ error: "Revisa el email." }, 400, cors)
    if (body.privacidad !== true) return json({ error: "Tienes que aceptar la política de privacidad." }, 400, cors)

    const ahora = new Date().toISOString()
    const descripcion = [
      `Solicitud desde el formulario de ${sitio.nombre}.`,
      "",
      `Nombre: ${nombre}`,
      negocio  ? `Negocio: ${negocio}` : null,
      telefono ? `Teléfono: ${telefono}` : null,
      email    ? `Email: ${email}` : null,
      intereses.length ? `Le interesa: ${intereses.join(", ")}` : null,
      mensaje  ? `\nMensaje:\n${mensaje}` : null,
      "",
      pagina ? `Página: ${pagina}` : null,
      `Aceptó la política de privacidad: ${ahora}`,
    ].filter(l => l !== null).join("\n")

    try {
      await hubDb({ origen: "formulario-web" }).post("oportunidades", {
        titulo: `${sitio.etiqueta} · ${negocio || nombre}${intereses.length ? ` · ${intereses.join(", ")}` : ""}`.slice(0, 200),
        descripcion,
        estado: "Detectado",
        origen: "web",
      })
    } catch (e) {
      console.error("formulario-web insert error", e)
      return json({ error: "No se pudo enviar. Inténtalo de nuevo o llámanos al 922 71 73 90." }, 500, cors)
    }
    return json({ ok: true }, 200, cors)
  } catch (e) {
    console.error("formulario-web", e)
    return json({ error: "Error interno. Llámanos al 922 71 73 90." }, 500, cors)
  }
})
