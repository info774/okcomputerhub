// documentos-indexar — mantiene el índice del buscador (hub.documentos y
// hub.documentos_fragmentos).
//
// Va en SIN_JWT: la lanza pg_cron cada 10 min (x-sync-token) con
// { accion: 'cola' }: apunta como pendiente lo que cambió (páginas de la wiki,
// conocimiento y tablero de la app y, cada 6 h, la carpeta de Drive) e indexa
// pendientes hasta agotar el tiempo. Desde el hub, con sesión:
//   { accion: 'pagina', id }   → reindexa esa página ya (al guardarla)
//   { accion: 'estado' }       → cuántos hay de cada fuente y estado
//   { accion: 'drive' }        → (admin) vuelve a mirar la carpeta de Drive ahora
// Formatos de Drive: Documentos, Hojas y Presentaciones de Google, PDF, Word
// (.docx), texto, markdown y CSV. El resto se apunta como «omitido».
import { makeCorsHeaders, json, getAuthedUser, isAdminUser, unauthorized, forbidden, mismoToken } from '../_shared/http.ts'
import { hubDb, type Db, type Fila, esUuid } from '../_shared/hub-db.ts'
import { vectorizar, comoVector, trocear } from '../_shared/rag.ts'
import { googleFetch, googleConfigurado } from '../_shared/google.ts'
import { extractText, getDocumentProxy } from 'npm:unpdf@^1.4.0'
import { unzipSync, strFromU8 } from 'npm:fflate@^0.8.2'

const DRIVE = ['https://www.googleapis.com/auth/drive.readonly']
const PRESUPUESTO_MS = 110_000
const CADA_DRIVE_MS = 6 * 3600_000

// ── Qué hay que indexar ─────────────────────────────────────────────────────
async function sincronizarLista(db: Db, fuente: string, actuales: Fila[], prefijo = '') {
  const tiene = await db.get(`documentos?select=id,ref,modificado_at,estado&fuente=eq.${fuente}${prefijo ? `&ref=like.${encodeURIComponent(prefijo)}*` : ''}`)
  const porRef = new Map(tiene.map(d => [d.ref as string, d]))
  const nuevos: Fila[] = []
  for (const a of actuales) {
    const d = porRef.get(a.ref as string)
    const cambio = !d || (a.modificado_at && (!d.modificado_at || new Date(a.modificado_at as string) > new Date(d.modificado_at as string)))
    if (cambio) nuevos.push({ fuente, ...a, estado: 'pendiente', error: null })
  }
  if (nuevos.length) await db.upsert('documentos', 'fuente,ref', nuevos)
  const vivos = new Set(actuales.map(a => a.ref))
  const idos = tiene.filter(d => !vivos.has(d.ref))
  for (let i = 0; i < idos.length; i += 100) await db.del(`documentos?id=in.(${idos.slice(i, i + 100).map(d => d.id).join(',')})`)
  return { nuevos: nuevos.length, borrados: idos.length }
}

async function listaWiki(db: Db) {
  const ps = await db.get('paginas?select=id,titulo,updated_at&archivada=eq.false')
  return sincronizarLista(db, 'wiki', ps.map(p => ({ ref: p.id, titulo: p.titulo, url: `#/wiki/${p.id}`, mime: 'text/markdown', modificado_at: p.updated_at })))
}

async function listaApp(db: Db) {
  const [con, tab] = await Promise.all([
    db.get('conocimiento?select=id,titulo,created_at,url'),
    db.get('tablero_notas?select=id,titulo,created_at,updated_at'),
  ])
  return sincronizarLista(db, 'app', [
    ...con.map(c => ({ ref: `conocimiento:${c.id}`, titulo: c.titulo, url: c.url ?? null, mime: 'text/plain', modificado_at: c.created_at })),
    ...tab.map(t => ({ ref: `tablero:${t.id}`, titulo: `Nota: ${t.titulo}`, url: null, mime: 'text/plain', modificado_at: t.updated_at ?? t.created_at })),
  ])
}

async function carpetaDrive(db: Db): Promise<string | null> {
  const [c] = await db.get('config?select=valor&clave=eq.drive_carpeta')
  const v = c?.valor
  return typeof v === 'string' && v ? v : null
}

async function listaDrive(db: Db, forzar = false) {
  const carpeta = await carpetaDrive(db)
  if (!carpeta || !googleConfigurado()) return { omitido: !carpeta ? 'sin carpeta' : 'sin clave de Google' }
  const [e] = await db.get('sync_estado?select=ultima_ok&clave=eq.drive')
  if (!forzar && e?.ultima_ok && Date.now() - new Date(e.ultima_ok as string).getTime() < CADA_DRIVE_MS) return { omitido: 'reciente' }
  const ficheros: Fila[] = []
  const pendientes = [carpeta]
  const vistas = new Set<string>()
  while (pendientes.length && vistas.size < 200) {
    const id = pendientes.shift()!
    if (vistas.has(id)) continue
    vistas.add(id)
    let token = ''
    do {
      const q = new URLSearchParams({ q: `'${id}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size)',
        pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(token ? { pageToken: token } : {}) })
      const r = await googleFetch(`https://www.googleapis.com/drive/v3/files?${q}`, DRIVE)
      const j = await r.json()
      if (!r.ok) throw new Error(`Drive: ${j.error?.message ?? r.status}`)
      for (const f of j.files ?? []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') pendientes.push(f.id)
        else ficheros.push({ ref: f.id, titulo: f.name, url: f.webViewLink, mime: f.mimeType, modificado_at: f.modifiedTime })
      }
      token = j.nextPageToken ?? ''
    } while (token)
  }
  const r = await sincronizarLista(db, 'drive', ficheros)
  await db.upsert('sync_estado', 'clave', [{ clave: 'drive', ultima_ok: new Date().toISOString(), filas: ficheros.length, ultimo_error: null }])
  return { ficheros: ficheros.length, ...r }
}

// ── Sacar el texto ──────────────────────────────────────────────────────────
const EXPORTAR: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
}

async function textoDrive(d: Fila): Promise<string | null> {
  const mime = String(d.mime ?? '')
  const base = `https://www.googleapis.com/drive/v3/files/${d.ref}`
  if (EXPORTAR[mime]) {
    const r = await googleFetch(`${base}/export?mimeType=${encodeURIComponent(EXPORTAR[mime])}`, DRIVE)
    if (!r.ok) throw new Error(`Drive export ${r.status}`)
    return await r.text()
  }
  const descargar = async () => {
    const r = await googleFetch(`${base}?alt=media&supportsAllDrives=true`, DRIVE)
    if (!r.ok) throw new Error(`Drive descarga ${r.status}`)
    const b = new Uint8Array(await r.arrayBuffer())
    if (b.length > 20_000_000) throw new Error('fichero de más de 20 MB')
    return b
  }
  if (mime === 'application/pdf') {
    const pdf = await getDocumentProxy(await descargar())
    const { text } = await extractText(pdf, { mergePages: true })
    return String(text)
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const zip = unzipSync(await descargar(), { filter: f => f.name === 'word/document.xml' })
    const xml = strFromU8(zip['word/document.xml'] ?? new Uint8Array())
    return xml.replace(/<\/w:p>/g, '\n\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  }
  if (mime.startsWith('text/') || mime === 'application/json') return new TextDecoder().decode(await descargar())
  return null
}

async function textoDe(db: Db, d: Fila): Promise<string | null> {
  if (d.fuente === 'wiki') {
    const [p] = await db.get(`paginas?select=titulo,contenido&id=eq.${d.ref}`)
    return p ? `${p.titulo}\n\n${p.contenido}` : null
  }
  if (d.fuente === 'app') {
    const [tipo, id] = String(d.ref).split(':')
    if (tipo === 'conocimiento') {
      const [c] = await db.get(`conocimiento?select=*&id=eq.${id}`)
      return c ? [c.titulo, c.categoria && `Categoría: ${c.categoria}`, c.tipo && `Tipo: ${c.tipo}`, c.descripcion, c.url && `Enlace: ${c.url}`,
        c.palabras_clave && `Palabras clave: ${c.palabras_clave}`].filter(Boolean).join('\n') : null
    }
    const [t] = await db.get(`tablero_notas?select=*&id=eq.${id}`)
    return t ? `${t.titulo}\n\n${t.descripcion ?? ''}` : null
  }
  return textoDrive(d)
}

async function indexarUno(db: Db, d: Fila) {
  try {
    const texto = await textoDe(db, d)
    if (texto == null) {
      await db.patch(`documentos?id=eq.${d.id}`, { estado: 'omitido', error: `formato no indexable (${d.mime})`, fragmentos: 0, indexado_at: new Date().toISOString() })
      await db.rpc('guardar_fragmentos', { p_documento: d.id, p_trozos: [] })
      return
    }
    const trozos = trocear(texto)
    const filas: Fila[] = []
    for (const [i, t] of trozos.entries()) {
      filas.push({ documento_id: d.id, orden: i, texto: t, embedding: comoVector(await vectorizar(`${d.titulo}\n${t}`)) })
    }
    // Por función: el service_role no puede usar el tipo vector (vive en public, cerrado).
    await db.rpc('guardar_fragmentos', { p_documento: d.id, p_trozos: filas.map(({ orden, texto, embedding }) => ({ orden, texto, embedding })) })
    await db.patch(`documentos?id=eq.${d.id}`, { estado: 'indexado', error: null, fragmentos: filas.length, indexado_at: new Date().toISOString() })
  } catch (e) {
    await db.patch(`documentos?id=eq.${d.id}`, { estado: 'error', error: (e as Error).message.slice(0, 500), indexado_at: new Date().toISOString() })
  }
}

async function cola(db: Db, forzarDrive = false) {
  const inicio = Date.now()
  const r: Fila = { wiki: await listaWiki(db), app: await listaApp(db) }
  try { r.drive = await listaDrive(db, forzarDrive) } catch (e) {
    r.drive = { error: (e as Error).message }
    await db.upsert('sync_estado', 'clave', [{ clave: 'drive', ultimo_error: (e as Error).message.slice(0, 500), ultimo_error_at: new Date().toISOString() }]).catch(() => {})
  }
  let hechos = 0
  while (Date.now() - inicio < PRESUPUESTO_MS) {
    const lote = await db.get('documentos?select=*&estado=eq.pendiente&order=fuente.desc,modificado_at.desc&limit=5')
    if (!lote.length) break
    for (const d of lote) { await indexarUno(db, d); hechos++; if (Date.now() - inicio > PRESUPUESTO_MS) break }
  }
  const [{ count }] = (await db.get('documentos?select=count&estado=eq.pendiente')) as { count: number }[]
  return { ...r, indexados: hechos, quedan: count }
}

async function estado(db: Db) {
  const docs = await db.get('documentos?select=fuente,estado,fragmentos')
  const resumen: Record<string, Record<string, number>> = {}
  for (const d of docs) { (resumen[d.fuente as string] ??= {})[d.estado as string] = ((resumen[d.fuente as string] ?? {})[d.estado as string] ?? 0) + 1 }
  const [drive] = await db.get('sync_estado?select=ultima_ok,ultimo_error,filas&clave=eq.drive')
  const errores = await db.get('documentos?select=titulo,error,fuente&estado=eq.error&order=indexado_at.desc&limit=10')
  return { resumen, fragmentos: docs.reduce((s, d) => s + Number(d.fragmentos ?? 0), 0), drive: { carpeta: await carpetaDrive(db), google: googleConfigurado(), ...(drive ?? {}) }, errores }
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const db = hubDb({ origen: 'indexar' })
  const cuerpo = await req.json().catch(() => ({}))
  const tokenCron = ((await db.rpc('secreto', { p_nombre: 'hub_sync_token' }).catch(() => '')) as string) || ''
  try {
    if (mismoToken(req.headers.get('x-sync-token') ?? '', tokenCron)) return json({ ok: true, ...(await cola(db)) }, 200, cors)
    const user = await getAuthedUser(req)
    if (!user?.email) return unauthorized(cors)
    const [p] = await db.get(`usuarios?select=id&activo=eq.true&email=ilike.${encodeURIComponent(user.email.replace(/[\\%_]/g, '\\$&'))}`)
    if (!p) return forbidden(cors, 'No estás dado de alta en el hub.')
    if (cuerpo.accion === 'estado') return json(await estado(db), 200, cors)
    if (cuerpo.accion === 'pagina') {
      if (!esUuid(cuerpo.id)) return json({ error: 'id no válido' }, 400, cors)
      await listaWiki(db)
      const [d] = await db.get(`documentos?select=*&fuente=eq.wiki&ref=eq.${cuerpo.id}`)
      if (d) await indexarUno(db, d)
      return json({ ok: true, indexada: !!d }, 200, cors)
    }
    if (cuerpo.accion === 'drive') {
      if (!(await isAdminUser(user))) return forbidden(cors)
      return json({ ok: true, ...(await cola(db, true)) }, 200, cors)
    }
    return json({ error: 'Acción desconocida (estado, pagina, drive)' }, 400, cors)
  } catch (e) {
    console.error('[indexar]', e)
    return json({ ok: false, error: (e as Error).message }, 500, cors)
  }
})
