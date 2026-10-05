// Comandas (fase 8): texto o audio → tareas del hub repartidas por persona.
// Lo usan la función `comandas` (pantalla #/comandas), el bot de Telegram
// (notas de voz) y el MCP. Audio → texto con Groq Whisper (GROQ_API_KEY);
// texto → tareas con Claude (_shared/claude.ts). Sin Claude se trocea por
// líneas/frases y se reconoce a la persona si la frase empieza por su nombre.
import type { Db, Fila } from './hub-db.ts'
import { claudeConfigurado, preguntarClaude } from './claude.ts'
import { enviarTelegram, h } from './mensajeria.ts'
import { avisarPush } from './push.ts'

export const groqConfigurado = () => !!Deno.env.get('GROQ_API_KEY')

export async function transcribir(audio: Uint8Array, mime: string, nombre = 'audio.webm'): Promise<string> {
  const key = Deno.env.get('GROQ_API_KEY')
  if (!key) throw new Error('Falta GROQ_API_KEY para pasar el audio a texto (ver docs/PENDIENTE_FRAN.md)')
  if (audio.byteLength > 24 * 1024 * 1024) throw new Error('El audio es demasiado largo (máximo ~25 MB)')
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime || 'audio/webm' }), nombre)
  form.append('model', Deno.env.get('GROQ_STT_MODEL') ?? 'whisper-large-v3-turbo')
  form.append('language', 'es')
  form.append('response_format', 'json')
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(90000) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Groq no transcribió el audio: ${j.error?.message ?? res.status}`)
  return String(j.text ?? '').trim()
}

export interface TareaPropuesta { texto: string; persona: string | null; prioridad: boolean; fecha_limite: string | null }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Sin Claude: una tarea por línea o frase; «Tito, …» / «que Tito …» la reparte.
export function trocearSinIA(texto: string, personas: { nombre: string }[]): TareaPropuesta[] {
  const trozos = texto.split(/\n+|(?<=[.!?;])\s+/).map(t => t.replace(/^[\s\-*•\d.)]+/, '').trim()).filter(t => t.length > 2)
  return trozos.map(t => {
    const n = norm(t)
    const p = personas.find(x => { const pila = norm(x.nombre).split(/\s+/)[0]; return pila && (n.startsWith(pila + ' ') || n.startsWith(pila + ',') || n.startsWith(pila + ':') || n.startsWith('que ' + pila + ' ')) })
    return { texto: t.charAt(0).toUpperCase() + t.slice(1), persona: p?.nombre ?? null, prioridad: /urgente|ya mismo|cuanto antes|prioridad/i.test(t), fecha_limite: null }
  })
}

export async function trocear(texto: string, personas: { nombre: string }[], hoy: string): Promise<{ tareas: TareaPropuesta[]; con_claude: boolean }> {
  if (!claudeConfigurado()) return { tareas: trocearSinIA(texto, personas), con_claude: false }
  const r = await preguntarClaude<{ tareas: TareaPropuesta[] }>({
    sistema: `Eres quien reparte el trabajo en Ok Computer Tenerife (servicios informáticos). Te llega lo que el jefe ha dictado o escrito, a veces desordenado. Sácalo en TAREAS concretas, una por cosa a hacer, redactadas como orden corta en español («Llamar al Hotel Playa por la factura de agosto»). Mantén nombres de clientes, sitios, importes y detalles tal cual. Reparte cada tarea a UNA persona del equipo solo si el texto lo dice o es inequívoco (usa exactamente uno de estos nombres: ${personas.map(p => p.nombre).join(', ')}); si no, persona = null. prioridad = true solo si lo pide (urgente, hoy mismo, lo primero…). fecha_limite (AAAA-MM-DD) solo si dice un día; hoy es ${hoy}. No inventes tareas ni añadas consejos.`,
    contenido: texto,
    maxTokens: 3000,
    esfuerzo: 'low',
    esquema: { type: 'object', additionalProperties: false, required: ['tareas'], properties: { tareas: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['texto', 'persona', 'prioridad', 'fecha_limite'],
      properties: { texto: { type: 'string' }, persona: { type: ['string', 'null'] }, prioridad: { type: 'boolean' }, fecha_limite: { type: ['string', 'null'] } } } } } },
  })
  return { tareas: (r.tareas ?? []).filter(t => t.texto?.trim()), con_claude: true }
}

export interface Resultado { comanda_id: string; tareas: Fila[]; con_claude: boolean; transcripcion: string }

// Guarda la comanda y sus tareas y avisa por Telegram a quien le toca.
export async function crearComanda(db: Db, o: { texto: string; origen: 'app' | 'telegram' | 'mcp' | 'reloj'; autorId: string; autorNombre: string }): Promise<Resultado> {
  const texto = o.texto.trim().slice(0, 8000)
  if (texto.length < 3) throw new Error('La comanda está vacía')
  const personas = (await db.get('usuarios?select=id,nombre&activo=eq.true&order=nombre')) as { id: string; nombre: string }[]
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Canary' })
  const { tareas, con_claude } = await trocear(texto, personas, hoy)
  const [c] = await db.post('comandas', { transcripcion: texto, origen: o.origen, creada_por: o.autorId, con_claude, n_tareas: tareas.length })
  const idDe = (n: string | null) => { if (!n) return null; const x = norm(n); return personas.find(p => norm(p.nombre) === x || norm(p.nombre).split(/\s+/)[0] === x.split(/\s+/)[0])?.id ?? null }
  const filas = tareas.slice(0, 40).map(t => ({ comanda_id: c.id, texto: t.texto.slice(0, 500), persona_id: idDe(t.persona), prioridad: !!t.prioridad,
    fecha_limite: /^\d{4}-\d{2}-\d{2}$/.test(t.fecha_limite ?? '') ? t.fecha_limite : null, origen: o.origen === 'app' ? 'voz' : o.origen, creada_por: o.autorId }))
  const creadas = filas.length ? await db.post('comanda_tareas', filas) : []
  await avisar(db, creadas, personas, o.autorId, o.autorNombre)
  return { comanda_id: c.id as string, tareas: creadas, con_claude, transcripcion: texto }
}

async function avisar(db: Db, tareas: Fila[], personas: { id: string; nombre: string }[], autorId: string, autor: string) {
  const por = new Map<string, Fila[]>()
  for (const t of tareas) if (t.persona_id && t.persona_id !== autorId) por.set(t.persona_id as string, [...(por.get(t.persona_id as string) ?? []), t])
  if (!por.size) return
  // En el móvil (push) además de por Telegram.
  await Promise.all([...por].map(([id, ts]) => avisarPush([id], { title: `${autor} te ha pasado ${ts.length === 1 ? 'una comanda' : ts.length + ' comandas'}`,
    body: ts.map(t => `${t.prioridad ? 'URGENTE: ' : ''}${t.texto}`).join(' · '), tag: `comanda-${ts[0].comanda_id}`, url: '/#/comandas' })))
  const vs = await db.get(`telegram_vinculos?select=usuario_id,chat_id&activo=eq.true&chat_id=not.is.null&usuario_id=in.(${[...por.keys()].join(',')})`).catch(() => [])
  for (const v of vs) {
    const ts = por.get(v.usuario_id as string) ?? []
    await enviarTelegram(v.chat_id as number, `🧾 <b>${h(autor)} te ha pasado ${ts.length === 1 ? 'una comanda' : ts.length + ' comandas'}</b>\n${ts.map(t => `• ${t.prioridad ? '🔴 ' : ''}${h(t.texto)}${t.fecha_limite ? ` <i>(para el ${h(t.fecha_limite)})</i>` : ''}`).join('\n')}\n\n<a href="https://okhub-tenerife.web.app/#/comandas">Ver el tablero</a>`).catch(() => {})
  }
  void personas
}
