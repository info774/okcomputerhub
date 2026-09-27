// Quién es quién para las funciones del canal: persona del hub por correo
// (sesión), por id (informe programado) o por chat de Telegram (bot).
import type { Db } from './hub-db.ts'
import type { Persona } from './informes.ts'

const COLS = 'id,nombre,email,rol'

export async function personaPorEmail(db: Db, email: string): Promise<Persona | null> {
  const [p] = await db.get(`usuarios?select=${COLS}&activo=eq.true&email=ilike.${encodeURIComponent(email.replace(/[\\%_]/g, '\\$&'))}`)
  return (p as unknown as Persona) ?? null
}

export async function personaPorId(db: Db, id: string): Promise<Persona | null> {
  const [p] = await db.get(`usuarios?select=${COLS}&activo=eq.true&id=eq.${id}`)
  return (p as unknown as Persona) ?? null
}

export async function chatDe(db: Db, usuarioId: string): Promise<number | null> {
  const [v] = await db.get(`telegram_vinculos?select=chat_id&usuario_id=eq.${usuarioId}&activo=eq.true&chat_id=not.is.null`)
  return (v?.chat_id as number) ?? null
}
