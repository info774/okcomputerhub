// Mensajería del hub hacia el equipo. Hoy, Telegram (bot propio); WhatsApp
// llegará aquí cuando el número deje de estar atado a la app actual.
//
// Secret: TELEGRAM_BOT_TOKEN (el que da @BotFather). El texto va en el HTML
// reducido de Telegram (<b>, <i>, <a href>, <code>): todo lo que venga de
// datos pasa por `h()` antes.

const API = () => `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''}`
export const telegramConfigurado = () => !!Deno.env.get('TELEGRAM_BOT_TOKEN')

// Escapar para el HTML de Telegram.
export const h = (v: unknown) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))

// deno-lint-ignore no-explicit-any
export async function telegram(metodo: string, cuerpo: Record<string, unknown> = {}): Promise<any> {
  if (!telegramConfigurado()) throw new Error('Falta TELEGRAM_BOT_TOKEN (ver docs/FASE3.md)')
  const res = await fetch(`${API()}/${metodo}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(20000),
  })
  const j = await res.json().catch(() => ({}))
  if (!j.ok) throw new Error(`Telegram ${metodo}: ${j.description ?? res.status}`)
  return j.result
}

// Telegram corta a 4096 caracteres: se parte por párrafos.
export async function enviarTelegram(chatId: number | string, texto: string): Promise<void> {
  const trozos: string[] = []
  let actual = ''
  for (const p of texto.split('\n\n')) {
    if ((actual + '\n\n' + p).length > 3900 && actual) { trozos.push(actual); actual = p } else actual = actual ? `${actual}\n\n${p}` : p
  }
  if (actual) trozos.push(actual)
  for (const t of trozos) {
    await telegram('sendMessage', { chat_id: chatId, text: t.slice(0, 4000), parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
  }
}
