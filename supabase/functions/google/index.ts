// google — lo de Google que la app hace en el navegador con la cuenta de cada
// uno (paridad bloque 7, tanda 5), aquí con la cuenta de servicio del hub
// (_shared/google.ts) y la delegación de dominio de Google Workspace:
//   { accion: 'calendario', desde, hasta }   la capa de Google Calendar del
//        calendario, SOLO LECTURA (calendar.readonly): el calendario de la
//        empresa (info@) y, si quien lo pide tiene correo de la empresa, el
//        suyo. Funciona ya (decisión de Fran), en cuanto la delegación tenga
//        ese permiso (PENDIENTE_FRAN §2 ter).
//   { accion: 'contacto', cliente_id }       guarda el cliente en Google
//        Contactos (de info@) y apunta su google_contact_id, como
//        syncClienteToGoogleContacts de la app. Listo para el cambio: con el
//        área `clientes` de la app contesta 409 (lo hace la app).
//   { accion: 'carpeta', cliente_id?, local_id? }  la carpeta de Drive del
//        cliente (o de la sede, dentro de la del cliente) en la carpeta
//        compartida de la empresa: la busca por nombre y si no está la crea,
//        como openClienteDriveFolder / openDriveLocal. Necesita que esa carpeta
//        esté compartida con la cuenta de servicio (PENDIENTE_FRAN §2 ter).
// Con sesión de una persona del hub.
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb, esUuid, type Db } from '../_shared/hub-db.ts'
import { tokenGoogle, googleConfigurado } from '../_shared/google.ts'

const DOMINIO = 'okcomputertenerife.com'
const EMPRESA = `info@${DOMINIO}`
// La carpeta compartida donde la app guarda todo lo de clientes y sitios (google-drive.js).
const DRIVE_RAIZ = Deno.env.get('GOOGLE_DRIVE_RAIZ') ?? '1on0v4QuHJHzC_33TmmS8kg--V4d-utH7'

const esFechaHora = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s))
const sinPermiso = (e: unknown) => /delegación|unauthorized_client/i.test(String((e as Error)?.message ?? e))

async function eventos(email: string, desde: string, hasta: string) {
  const token = await tokenGoogle(['https://www.googleapis.com/auth/calendar.readonly'], email)
  const q = new URLSearchParams({ timeMin: new Date(desde).toISOString(), timeMax: new Date(hasta).toISOString(), singleEvents: 'true', orderBy: 'startTime',
    maxResults: '250', fields: 'items(id,summary,location,start,end,htmlLink,status)' })
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message ?? `Google Calendar → ${r.status}`)
  return ((j.items ?? []) as any[]).filter(ev => ev.status !== 'cancelled').map(ev => {
    const todoDia = !!ev.start?.date && !ev.start?.dateTime
    return { id: `${email}:${ev.id}`, calendario: email === EMPRESA ? 'Empresa' : 'Tuyo', titulo: ev.summary || '(sin título)', ubicacion: ev.location || '',
      inicio: ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00` : null), fin: ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00` : null),
      todoDia, enlace: ev.htmlLink || 'https://calendar.google.com/calendar/r' }
  }).filter(e => e.inicio && e.fin)
}

async function delHub(db: Db, tabla: string) {
  const a = await db.get(`areas?select=dueno&tablas=cs.{${tabla}}&limit=1`)
  return ((a[0]?.dueno as string | undefined) ?? 'hub') === 'hub'
}

async function contacto(db: Db, clienteId: string) {
  const [c] = await db.get(`clientes?select=id,nombre,tipo,email,telefono,google_contact_id&id=eq.${clienteId}`)
  if (!c) throw new Error('No existe ese cliente')
  const token = await tokenGoogle(['https://www.googleapis.com/auth/contacts'], EMPRESA)
  const persona = {
    names: [{ givenName: c.nombre }],
    organizations: c.tipo === 'empresa' ? [{ name: c.nombre }] : [],
    emailAddresses: c.email ? [{ value: c.email }] : [],
    phoneNumbers: c.telefono ? [{ value: c.telefono, type: 'main' }] : [],
  }
  const cab = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  let r: Response
  if (c.google_contact_id) {
    // Para actualizar, Google pide la etag actual del contacto.
    const g = await fetch(`https://people.googleapis.com/v1/${c.google_contact_id}?personFields=metadata`, { headers: cab })
    const actual = await g.json().catch(() => ({}))
    if (g.ok) {
      r = await fetch(`https://people.googleapis.com/v1/${c.google_contact_id}:updateContact?updatePersonFields=names,emailAddresses,phoneNumbers,organizations`,
        { method: 'PATCH', headers: cab, body: JSON.stringify({ ...persona, etag: actual.etag }) })
      if (!r.ok) throw new Error(`Google Contactos → ${r.status}`)
      return { ok: true, google_contact_id: c.google_contact_id, actualizado: true }
    }
  }
  r = await fetch('https://people.googleapis.com/v1/people:createContact', { method: 'POST', headers: cab, body: JSON.stringify(persona) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.resourceName) throw new Error(j?.error?.message ?? `Google Contactos → ${r.status}`)
  await db.patch(`clientes?id=eq.${c.id}`, { google_contact_id: j.resourceName })
  return { ok: true, google_contact_id: j.resourceName, actualizado: false }
}

async function carpeta(db: Db, clienteId: string | null, localId: string | null) {
  const token = await tokenGoogle(['https://www.googleapis.com/auth/drive'])
  const cab = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  async function hija(nombre: string, padre: string) {
    const busca = new URLSearchParams({ q: `name = '${q(nombre)}' and '${padre}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?${busca}`, { headers: cab })
    const j = await r.json().catch(() => ({}))
    if (r.status === 404 || (!r.ok && /not found/i.test(j?.error?.message ?? ''))) throw new Error('sin_carpeta')
    if (!r.ok) throw new Error(j?.error?.message ?? `Google Drive → ${r.status}`)
    if (j.files?.[0]?.id) return j.files[0].id as string
    const c = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', { method: 'POST', headers: cab,
      body: JSON.stringify({ name: nombre, parents: [padre], mimeType: 'application/vnd.google-apps.folder' }) })
    const k = await c.json().catch(() => ({}))
    if (!c.ok || !k.id) throw new Error(c.status === 404 || c.status === 403 ? 'sin_carpeta' : (k?.error?.message ?? `Google Drive → ${c.status}`))
    return k.id as string
  }
  let local: any = null
  if (localId) [local] = await db.get(`locales?select=id,nombre,cliente_id&id=eq.${localId}`)
  const cid = clienteId ?? local?.cliente_id ?? null
  const [cli] = cid ? await db.get(`clientes?select=id,nombre&id=eq.${cid}`) : [null]
  if (!cli && !local) throw new Error('No existe ese cliente ni esa sede')
  let id = DRIVE_RAIZ
  if (cli) id = await hija(String(cli.nombre), id)
  if (local) id = await hija(String(local.nombre), id)
  return { url: `https://drive.google.com/drive/folders/${id}` }
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const db = hubDb({ origen: 'google', email: user.email })
  const [yo] = await db.get(`usuarios?select=id,nombre,email&activo=eq.true&email=ilike.${encodeURIComponent(user.email.replace(/[\\%_*]/g, ''))}&limit=1`)
  if (!yo) return forbidden(cors, 'No estás dado de alta en el hub.')
  if (!googleConfigurado()) return json({ error: 'Falta la clave de la cuenta de servicio de Google (GOOGLE_SA_KEY)' }, 503, cors)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  try {
    switch (b.accion) {
      case 'calendario': {
        if (!esFechaHora(b.desde) || !esFechaHora(b.hasta)) return json({ error: 'Fechas no válidas' }, 400, cors)
        if (Date.parse(String(b.hasta)) - Date.parse(String(b.desde)) > 62 * 86_400_000) return json({ error: 'Como mucho dos meses de una vez' }, 400, cors)
        const quien = [EMPRESA, ...(String(yo.email).toLowerCase().endsWith(`@${DOMINIO}`) && String(yo.email).toLowerCase() !== EMPRESA ? [String(yo.email)] : [])]
        const res = await Promise.allSettled(quien.map(e => eventos(e, String(b.desde), String(b.hasta))))
        const fallo = res.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
        if (res.every(r => r.status === 'rejected')) {
          return json({ eventos: [], error: sinPermiso(fallo?.reason) ? 'falta_permiso' : String(fallo?.reason?.message ?? fallo?.reason),
            mensaje: sinPermiso(fallo?.reason) ? 'Falta dar al hub el permiso de leer Google Calendar (docs/PENDIENTE_FRAN.md §2 ter).' : 'Google Calendar no contestó.' }, 200, cors)
        }
        return json({ eventos: res.flatMap(r => r.status === 'fulfilled' ? r.value : []) }, 200, cors)
      }
      case 'contacto': {
        if (!esUuid(b.cliente_id)) return json({ error: 'cliente_id no válido' }, 400, cors)
        if (!(await delHub(db, 'clientes'))) return json({ error: 'Los clientes se llevan todavía en la app: allí se guardan en Google Contactos.' }, 409, cors)
        return json(await contacto(db, String(b.cliente_id)), 200, cors)
      }
      case 'carpeta': {
        const cid = esUuid(b.cliente_id) ? String(b.cliente_id) : null, lid = esUuid(b.local_id) ? String(b.local_id) : null
        if (!cid && !lid) return json({ error: 'Falta el cliente o la sede' }, 400, cors)
        try { return json(await carpeta(db, cid, lid), 200, cors) } catch (e) {
          if ((e as Error).message === 'sin_carpeta') return json({ error: 'sin_carpeta', mensaje: 'La carpeta compartida de Drive no está compartida con el hub todavía (docs/PENDIENTE_FRAN.md §2 ter).' }, 200, cors)
          throw e
        }
      }
      default:
        return json({ error: 'Acción desconocida (calendario, contacto, carpeta)' }, 400, cors)
    }
  } catch (e) {
    console.error('[google]', e)
    return json({ error: (e as Error).message }, 502, cors)
  }
})
