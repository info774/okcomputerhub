// clientes — lo que el alta y la baja de un cliente necesitan FUERA de la
// base del hub (paridad con la app, bloque 2). Con sesión de una persona del hub.
//   nif {nif}                    → { nombre, fuente }  razón social buscando el
//                                  NIF en la web (lookup-nif de la app: Google
//                                  Custom Search si hay GOOGLE_CSE_KEY/ID, si no
//                                  DuckDuckGo). Solo lee: vale ya.
//   zoho_alta {cliente_id}       → { zoho_id, reutilizado }  push-cliente-to-zoho:
//                                  si el cliente no tiene zoho_id, busca en Zoho un
//                                  contacto con su NIF y si no, lo crea; guarda el
//                                  zoho_id. Idempotente.
//   zoho_quitar {cliente_id}     → { accion: 'borrado'|'desactivado'|'nada' }
//                                  delete-cliente-from-zoho: borra el contacto o,
//                                  si tiene facturas, lo desactiva; quita el zoho_id.
// Las dos de Zoho solo con el área `clientes` cortada (antes, 409): mientras
// la app mande, es ella quien habla con Zoho.
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb, esUuid } from '../_shared/hub-db.ts'
import { personaPorEmail } from '../_shared/personas.ts'
import { zohoEnviar, zohoGet } from '../_shared/zoho.ts'

const GENERICO = /buscador|informaci[oó]n de empresa|datos de empresa|consultar|cif de empresas|qu[eé] es el cif|gratis|directorio|p[aá]ginas amarillas|linkedin|facebook|einforma\.com$/i

// La razón social del título del resultado (extractCompanyName de la app).
function razonSocial(titulo: string, nif: string): string {
  if (!titulo) return ''
  const t = titulo.replace(new RegExp(nif, 'ig'), ' ').split(/\s[:|–—]\s|\s[-|]\s|:\s|\s\|\s/)[0]
    .replace(/\s+/g, ' ').trim().replace(/[.,;·\-\s]+$/, '').trim()
  return !t || t.length < 3 || GENERICO.test(t) ? '' : t
}

async function porGoogle(nif: string): Promise<string> {
  const key = Deno.env.get('GOOGLE_CSE_KEY'), cx = Deno.env.get('GOOGLE_CSE_ID')
  if (!key || !cx) return ''
  const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&num=5&q=${encodeURIComponent(nif + ' empresa')}`, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) return ''
  for (const it of (await res.json()).items ?? []) { const n = razonSocial(it.title ?? '', nif); if (n) return n }
  return ''
}

async function porDuckDuckGo(nif: string): Promise<string> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(nif + ' empresa CIF')}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', Accept: 'text/html', 'Accept-Language': 'es-ES,es;q=0.9' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return ''
  const html = await res.text()
  const re = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null, n = 0
  while ((m = re.exec(html)) !== null && n++ < 6) {
    const t = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim()
    const r = razonSocial(t, nif)
    if (r) return r
  }
  return ''
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const db = hubDb({ origen: 'clientes', email: user.email })
  const yo = await personaPorEmail(db, user.email)
  if (!yo) return forbidden(cors, 'No estás dado de alta en el hub.')
  const b = await req.json().catch(() => ({}))
  try {
    if (b.accion === 'nif') {
      const nif = String(b.nif ?? '').toUpperCase().replace(/[\s.\-]/g, '')
      if (!/^[A-Z0-9]{8,12}$/.test(nif)) return json({ error: 'NIF no válido' }, 400, cors)
      let nombre = '', fuente = ''
      try { nombre = await porGoogle(nif); if (nombre) fuente = 'google' } catch { /* probamos DuckDuckGo */ }
      if (!nombre) { try { nombre = await porDuckDuckGo(nif); if (nombre) fuente = 'duckduckgo' } catch { /* sin resultados */ } }
      return json({ nombre, fuente }, 200, cors)
    }

    if (b.accion === 'zoho_alta' || b.accion === 'zoho_quitar') {
      if (!esUuid(b.cliente_id)) return json({ error: 'Cliente no válido' }, 400, cors)
      const [area] = await db.get('areas?select=dueno&tablas=cs.{clientes}')
      if (area?.dueno !== 'hub') return json({ error: 'Los clientes se siguen llevando en la app: es ella quien habla con Zoho.' }, 409, cors)
      const [c] = await db.get(`clientes?select=id,nombre,zoho_id,nif,email,telefono,direccion,tipo&id=eq.${b.cliente_id}`)
      if (!c) return json({ error: 'Cliente no encontrado' }, 404, cors)

      if (b.accion === 'zoho_alta') {
        if (c.zoho_id) return json({ zoho_id: c.zoho_id, ya: true }, 200, cors)
        const nif = String(c.nif ?? '').trim()
        let id: string | null = null, reutilizado = false
        // Antes que crear: ¿hay ya un contacto con ese NIF (de Zoho CRM u otra vía)?
        if (nif) {
          const r = await zohoGet(db, 'contacts', { search_text: nif })
          // deno-lint-ignore no-explicit-any
          const m = (r.contacts ?? []).find((x: any) => [x.company_id, x.tax_reg_no].some(v => String(v ?? '').trim().toLowerCase() === nif.toLowerCase()))
          if (m) { id = m.contact_id; reutilizado = true }
        }
        if (!id) {
          const r = await zohoEnviar(db, 'POST', 'contacts', {
            contact_name: c.nombre || 'Sin nombre', contact_type: 'customer',
            customer_sub_type: c.tipo === 'individuo' ? 'individual' : 'business',
            ...(nif ? { company_id: nif } : {}),
            ...(c.direccion ? { billing_address: { address: c.direccion } } : {}),
            ...(c.email || c.telefono ? { contact_persons: [{ email: c.email || undefined, phone: c.telefono || undefined, is_primary_contact: true }] } : {}),
          })
          if (r.code !== 0) throw new Error(`Zoho no creó el contacto: ${r.message ?? 'sin detalle'}`)
          id = r.contact?.contact_id ?? null
        }
        if (!id) throw new Error('Zoho no devolvió el contacto')
        await db.patch(`clientes?id=eq.${c.id}`, { zoho_id: id })
        return json({ zoho_id: id, reutilizado }, 200, cors)
      }

      if (!c.zoho_id) return json({ accion: 'nada' }, 200, cors)
      let accion = 'borrado'
      const r = await zohoEnviar(db, 'DELETE', `contacts/${c.zoho_id}`)
      if (r.code !== 0) {
        // Con facturas Zoho no deja borrarlo: se desactiva y conserva el histórico.
        const r2 = await zohoEnviar(db, 'POST', `contacts/${c.zoho_id}/inactive`)
        if (r2.code !== 0) throw new Error(`Zoho no pudo borrar ni desactivar el contacto: ${r.message ?? r2.message ?? 'sin detalle'}`)
        accion = 'desactivado'
      }
      await db.patch(`clientes?id=eq.${c.id}`, { zoho_id: null })
      return json({ accion }, 200, cors)
    }

    return json({ error: 'Acción desconocida (nif, zoho_alta, zoho_quitar)' }, 400, cors)
  } catch (e) {
    console.error('[clientes]', e)
    return json({ error: (e as Error).message }, 502, cors)
  }
})
