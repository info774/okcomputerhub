// Claude (API de Anthropic) para lo que el hub redacta: respuestas del
// buscador (fase 5), reparto de comandas en tareas (fase 8), lectura de
// tickets de gasto (fase 10). Secret: ANTHROPIC_API_KEY.
//
// Modelo por defecto: claude-opus-5, con el respaldo del servidor
// (`fallbacks: "default"`) por si una petición se rechaza por política.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.128.0'

export const MODELO = Deno.env.get('CLAUDE_MODELO') ?? 'claude-opus-5'
export const claudeConfigurado = () => !!Deno.env.get('ANTHROPIC_API_KEY')

let _cliente: Anthropic | null = null
const cliente = () => (_cliente ??= new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') }))

export interface PeticionClaude {
  sistema: string
  // deno-lint-ignore no-explicit-any
  contenido: string | any[]
  maxTokens?: number
  esfuerzo?: 'low' | 'medium' | 'high'
  // Salida con forma fija (JSON Schema): se devuelve ya parseada.
  esquema?: Record<string, unknown>
}

// Una llamada: devuelve el texto (o el JSON si hay esquema). Lanza si Claude se niega.
export async function preguntarClaude<T = string>(p: PeticionClaude): Promise<T> {
  if (!claudeConfigurado()) throw new Error('Falta ANTHROPIC_API_KEY (ver docs/PENDIENTE_FRAN.md)')
  // deno-lint-ignore no-explicit-any
  const cuerpo: any = {
    model: MODELO,
    max_tokens: p.maxTokens ?? 4000,
    system: p.sistema,
    messages: [{ role: 'user', content: p.contenido }],
    output_config: { effort: p.esfuerzo ?? 'medium', ...(p.esquema ? { format: { type: 'json_schema', schema: p.esquema } } : {}) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  }
  const r = await cliente().beta.messages.create(cuerpo)
  if (r.stop_reason === 'refusal') throw new Error('Claude no ha querido contestar a esto')
  // deno-lint-ignore no-explicit-any
  const texto = (r.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('').trim()
  return (p.esquema ? JSON.parse(texto) : texto) as T
}
