// Utilidades para hablar con Groq desde las edge functions.
//
// POR QUÉ EXISTE ESTO: Groq retira modelos cada pocos meses sin avisar. El día
// que retiraron `llama-3.3-70b-versatile` el asistente de voz y el análisis de
// WhatsApp se quedaron devolviendo "Error al contactar la IA" (Groq responde
// 404 model_not_found), y la única salida fue editar el código y redesplegar a
// mano. Aquí el modelo NO se da por sentado: si el que se iba a usar ya no
// está, se le pregunta a Groq qué tiene disponible ahora mismo y se coge el
// mejor para este uso. Con el secret GROQ_MODEL (GROQ_STT_MODEL para el
// dictado, GROQ_VISION_MODEL para leer capturas) se puede fijar uno concreto
// sin tocar el código.

export const GROQ_CHAT_URL  = 'https://api.groq.com/openai/v1/chat/completions'
export const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_MODELS_URL       = 'https://api.groq.com/openai/v1/models'

// Modelos de chat por orden de preferencia para lo que pide esta app: seguir
// instrucciones largas en español y emitir bloques [[ACCION]]/JSON sin
// inventarse el formato. Sirve para dos cosas: ordenar lo que Groq dice tener,
// y como último recurso si no se puede consultar el listado.
const CHAT_PREFERIDOS = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'moonshotai/kimi-k2-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'qwen/qwen3-32b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
]

// Modelos de transcripción (Whisper): mismo problema, misma solución.
const AUDIO_PREFERIDOS = ['whisper-large-v3-turbo', 'whisper-large-v3']

// Modelos que además de texto ven imágenes (para leer una captura de
// WhatsApp). Son muchos menos que los de chat, así que si ninguno responde no
// hay reserva posible: quien llama debe avisar de que hay que pegar el texto.
const VISION_PREFERIDOS = [
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
]

// En el listado de Groq hay modelos que no sirven para chatear (y al revés).
const NO_ES_CHAT = /whisper|tts|guard|embed|moderation|distil|rerank/i
const ES_AUDIO   = /whisper|transcribe/i
// Groq no marca en el listado qué modelo ve imágenes, así que se reconocen por
// el nombre: la familia llama-4 es multimodal, y los que se llamen "vision"
// o "-vl" lo dicen ellos mismos.
const ES_VISION  = /llama-4|maverick|scout|vision|-vl\b|multimodal/i

// Cada intento fallido es un viaje a Groq: mejor rendirse pronto con un error
// claro que dejar al técnico esperando con el móvil en la mano.
const MAX_INTENTOS = 4

type Tipo = 'chat' | 'audio' | 'vision'

const PREFERIDOS: Record<Tipo, string[]> = {
  chat:   CHAT_PREFERIDOS,
  audio:  AUDIO_PREFERIDOS,
  vision: VISION_PREFERIDOS,
}
const ENV_MODELO: Record<Tipo, string> = {
  chat:   'GROQ_MODEL',
  audio:  'GROQ_STT_MODEL',
  vision: 'GROQ_VISION_MODEL',
}

// Cache por isolate: en cuanto un modelo responde bien, las siguientes
// peticiones de esa instancia van directas a él sin consultar nada.
let _chatCache:   string | null = null
let _audioCache:  string | null = null
let _visionCache: string | null = null

const leerCache = (t: Tipo) => t === 'chat' ? _chatCache : t === 'audio' ? _audioCache : _visionCache
function guardarCache(t: Tipo, modelo: string | null) {
  if (t === 'chat') _chatCache = modelo
  else if (t === 'audio') _audioCache = modelo
  else _visionCache = modelo
}

export interface RespuestaGroq {
  ok: boolean
  status: number       // el que debe devolver la edge function
  contenido?: string   // texto de la respuesta (chat) o transcripción (audio)
  modelo?: string
  error?: string       // mensaje ya listo para enseñar/escuchar
  detalle?: string     // cuerpo crudo de Groq, para el console.error
}

// Groq no usa un solo código para "ese modelo ya no está": según el caso llega
// 404 model_not_found o un 400 diciendo que está retirado (decommissioned).
function modeloNoDisponible(status: number, detalle: string): boolean {
  if (status !== 404 && status !== 400) return false
  return /model_not_found|does not exist|decommission|deprecat|no longer/i.test(detalle)
}

function puntuar(id: string, preferidos: string[]): number {
  const i = preferidos.indexOf(id)
  if (i >= 0) return 1000 - i
  // Modelos que aún no conocemos por nombre: heurística por tamaño y tipo, para
  // que uno nuevo y grande gane a uno pequeño sin tener que tocar el código.
  let p = 0
  if (/70b|120b|large|maverick|k2/i.test(id))      p += 30
  if (/versatile|instruct/i.test(id))              p += 10
  if (/instant|mini|scout|8b|20b|1b|3b/i.test(id)) p -= 10
  if (/preview|beta|deprecated/i.test(id))         p -= 20
  return p
}

// Qué tiene Groq disponible AHORA para esta clave, de mejor a peor. Si no se
// puede consultar (red, permisos), devuelve vacío y se tira de la lista fija.
async function listarModelos(apiKey: string, tipo: Tipo): Promise<string[]> {
  try {
    const res = await fetch(GROQ_MODELS_URL, { headers: { 'Authorization': `Bearer ${apiKey}` } })
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    const filas: Record<string, unknown>[] = Array.isArray(data?.data) ? data.data : []
    const preferidos = PREFERIDOS[tipo]
    return filas
      .filter((m) => typeof m?.id === 'string' && m.active !== false)
      .map((m) => m.id as string)
      .filter((id) => (tipo === 'audio' ? ES_AUDIO.test(id)
                     : tipo === 'vision' ? ES_VISION.test(id) && !NO_ES_CHAT.test(id)
                     : !NO_ES_CHAT.test(id)))
      .sort((a, b) => puntuar(b, preferidos) - puntuar(a, preferidos))
  } catch {
    return []
  }
}

// Orden en que se prueban los modelos, generado de forma PEREZOSA: mientras el
// primero funcione no se consulta nada más. Primero el fijado a mano, luego el
// que ya funcionó en este isolate, luego lo que Groq diga tener ahora, y de
// último recurso la lista fija de arriba (por si el listado no responde).
async function* candidatos(apiKey: string, tipo: Tipo): AsyncGenerator<string> {
  const vistos = new Set<string>()
  const dar = function* (ids: (string | null | undefined)[]) {
    for (const id of ids) {
      if (!id || vistos.has(id)) continue
      vistos.add(id)
      yield id
    }
  }
  yield* dar([
    Deno.env.get(ENV_MODELO[tipo])?.trim(),
    leerCache(tipo),
  ])
  yield* dar(await listarModelos(apiKey, tipo))
  yield* dar(PREFERIDOS[tipo])
}

// Núcleo compartido: prueba modelos hasta que uno responda, y traduce el fallo
// a algo que la edge function pueda devolver tal cual.
async function conModelo(
  apiKey: string,
  tipo: Tipo,
  etiqueta: string,
  enviar: (modelo: string) => Promise<Response>,
  leer: (data: Record<string, unknown> | null) => string,
): Promise<RespuestaGroq> {
  const errorGenerico = tipo === 'audio' ? 'No se pudo transcribir el audio.'
                      : tipo === 'vision' ? 'No se pudo leer la captura.'
                      : 'Error al contactar la IA.'
  let intentos = 0
  let detalle = ''

  for await (const modelo of candidatos(apiKey, tipo)) {
    if (++intentos > MAX_INTENTOS) break

    const res = await enviar(modelo)
    if (res.ok) {
      guardarCache(tipo, modelo)
      const data = await res.json().catch(() => null)
      return { ok: true, status: 200, contenido: leer(data), modelo }
    }

    detalle = await res.text().catch(() => '')
    if (res.status === 429) {
      return { ok: false, status: 429, error: 'Límite de uso alcanzado, prueba en un momento.', detalle }
    }
    if (!modeloNoDisponible(res.status, detalle)) {
      return { ok: false, status: 502, error: errorGenerico, detalle }
    }
    // Ese modelo ya no existe: se descarta y se prueba el siguiente.
    console.error(`[${etiqueta}] modelo descartado (${res.status}): ${modelo}`)
    if (leerCache(tipo) === modelo) guardarCache(tipo, null)
  }

  return {
    ok: false, status: 502, detalle,
    error: tipo === 'audio'
      ? 'La transcripción no está disponible: su modelo ha sido retirado.'
      : tipo === 'vision'
        ? 'La lectura de capturas no está disponible: su modelo ha sido retirado.'
        : 'La IA no está disponible: su modelo ha sido retirado. Hay que actualizarlo.',
  }
}

/**
 * Chat con Groq eligiendo un modelo disponible. `cuerpo` es el payload de la
 * API SIN el campo `model` (messages, temperature, max_tokens, response_format…).
 */
export function groqChat(
  apiKey: string,
  cuerpo: Record<string, unknown>,
  etiqueta: string,
): Promise<RespuestaGroq> {
  return conModelo(
    apiKey, 'chat', etiqueta,
    (modelo) => fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ ...cuerpo, model: modelo }),
    }),
    (data) => String((data as any)?.choices?.[0]?.message?.content ?? '').trim(),
  )
}

/**
 * Igual que `groqChat` pero eligiendo entre los modelos que SABEN VER
 * imágenes: el `cuerpo` lleva mensajes con partes `image_url` (data URL en
 * base64 vale). Se separa de `groqChat` porque el mejor modelo de texto casi
 * nunca es multimodal, y mandarle una imagen le hace devolver un error raro.
 */
export function groqVision(
  apiKey: string,
  cuerpo: Record<string, unknown>,
  etiqueta: string,
): Promise<RespuestaGroq> {
  return conModelo(
    apiKey, 'vision', etiqueta,
    (modelo) => fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ ...cuerpo, model: modelo }),
    }),
    (data) => String((data as any)?.choices?.[0]?.message?.content ?? '').trim(),
  )
}

/**
 * Transcripción de audio con Groq (Whisper), con el mismo respaldo de modelo.
 * `hacerForm` se llama una vez por intento: un FormData ya enviado no se puede
 * reutilizar.
 */
export function groqTranscribir(
  apiKey: string,
  hacerForm: (modelo: string) => FormData,
  etiqueta: string,
): Promise<RespuestaGroq> {
  return conModelo(
    apiKey, 'audio', etiqueta,
    (modelo) => fetch(GROQ_AUDIO_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: hacerForm(modelo),
    }),
    (data) => String((data as any)?.text ?? '').trim(),
  )
}
