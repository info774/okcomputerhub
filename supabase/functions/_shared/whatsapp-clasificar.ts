// Clasificador de avisos de WhatsApp, compartido por `parse-whatsapp` (el
// cliente pega o captura el chat a mano) y `whatsapp-webhook` (los mensajes
// entran solos por la Cloud API de Meta). Un solo prompt para los dos: si se
// afina uno, el otro no se queda atrás.

import { groqChat } from "./groq.ts"

export const SYSTEM_PROMPT = `Eres el clasificador de avisos de OK Computer Tenerife, una empresa de
informática, TPV, alarmas Ajax, cámaras Dahua/Hikvision y redes en Tenerife.

Recibes el texto de una conversación de WhatsApp de un cliente (puede venir con
el formato de exportación de WhatsApp, con marcas como "[12/7/26, 9:15]
Nombre:", o ser un único mensaje suelto). Tu trabajo es resumirlo en una ficha
de aviso.

Responde SOLO con un objeto JSON válido, sin markdown ni texto alrededor, con
exactamente estas claves:
{
  "tipo": "ticket" | "trabajo",
  "titulo": "resumen del problema en 6-9 palabras, sin punto final",
  "descripcion": "2-4 frases claras y profesionales con TODO el detalle técnico",
  "prioridad": "Alta" | "Media" | "Baja",
  "remitente": "nombre de quien escribe si aparece, si no cadena vacía",
  "telefono": "teléfono que aparezca en el texto, si no cadena vacía",
  "cliente": "nombre del negocio, local o empresa mencionado, si no cadena vacía",
  "fecha": "AAAA-MM-DD si piden un día concreto, si no cadena vacía",
  "hora": "HH:MM en 24h si piden una hora concreta, si no cadena vacía"
}

CRITERIOS:
- "tipo": usa "ticket" cuando es una incidencia o avería que hay que
  diagnosticar (algo no funciona, da error, va lento). Usa "trabajo" cuando el
  cliente pide una intervención planificada: instalación, montaje, ampliación,
  traslado, presupuesto de obra o una visita en una fecha concreta.
- "prioridad": "Alta" si el negocio está parado o no puede cobrar (TPV caído,
  sin internet, alarma saltando, "urgente", "ya"); "Baja" si es una consulta o
  algo que puede esperar; "Media" en el resto.
- "descripcion": redáctala tú, no copies el dictado literal. Quita saludos,
  muletillas y repeticiones, pero CONSERVA todos los datos técnicos: marcas,
  modelos, mensajes de error, números de serie, cantidades, ubicaciones y a
  quién hay que avisar.
- "remitente": el nombre que aparece antes de los dos puntos en las líneas de
  WhatsApp, o como se presenta la persona. No inventes nombres.
- "cliente": el nombre comercial del negocio si se menciona (por ejemplo
  "Bar Manolo", "Hotel Oasis"). Si solo hay un nombre de persona, déjalo vacío.
- Convierte expresiones como "mañana" o "el viernes" a fecha AAAA-MM-DD usando
  la fecha de hoy que se indica al final. Si no piden día, deja "fecha" vacía.
- Si un dato no está en el texto, devuelve cadena vacía. No inventes nada.
- Escribe siempre en español de España.`

// Lo que añade el webhook: aquí no hay una persona que decida si aquello es un
// aviso. «Gracias», «ok», un saludo suelto o un emoji no pueden abrir ticket.
const PROMPT_WEBHOOK = `${SYSTEM_PROMPT}

ADEMÁS: estos mensajes han llegado SOLOS al WhatsApp de la empresa, sin que
nadie los haya revisado. Añade una clave más:
  "es_aviso": true | false
Pon false si NO hay nada que hacer todavía: un saludo suelto ("hola", "buenas"),
un agradecimiento, un "ok", un emoji, una confirmación de algo ya hablado, o
publicidad/spam. Pon true si el cliente cuenta un problema, pide algo (visita,
presupuesto, factura, información concreta) o pregunta por un servicio.`

export interface Clasificacion {
  es_aviso: boolean
  tipo: 'ticket' | 'trabajo'
  titulo: string
  descripcion: string
  prioridad: 'Alta' | 'Media' | 'Baja'
  cliente: string
  fecha: string
  hora: string
}

export async function clasificarMensajes(apiKey: string, texto: string, contexto: string): Promise<Clasificacion | null> {
  const ahora = new Date()
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary' }).format(ahora)
  const dia = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', weekday: 'long' }).format(ahora)
  const r = await groqChat(apiKey, {
    messages: [
      { role: 'system', content: `${PROMPT_WEBHOOK}\n\nFECHA DE HOY: ${dia} ${ymd} (hora de Canarias).` },
      { role: 'user', content: `${contexto ? contexto + '\n\n' : ''}Mensajes de WhatsApp:\n"""\n${texto.slice(0, 6000)}\n"""` },
    ],
    temperature: 0.2,
    max_tokens: 700,
    response_format: { type: 'json_object' },
  }, 'whatsapp-webhook')
  if (!r.ok) { console.error('[whatsapp-clasificar] Groq', r.status, r.detalle ?? ''); return null }
  let p: Record<string, unknown>
  try { p = JSON.parse(r.contenido ?? '') } catch { return null }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return {
    es_aviso: p.es_aviso !== false,
    tipo: str(p.tipo).toLowerCase() === 'trabajo' ? 'trabajo' : 'ticket',
    titulo: str(p.titulo).slice(0, 120) || 'Aviso por WhatsApp',
    descripcion: str(p.descripcion),
    prioridad: (['Alta', 'Media', 'Baja'].find(x => x.toLowerCase() === str(p.prioridad).toLowerCase()) ?? 'Media') as Clasificacion['prioridad'],
    cliente: str(p.cliente).slice(0, 120),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(str(p.fecha)) ? str(p.fecha) : '',
    hora: /^\d{2}:\d{2}$/.test(str(p.hora)) ? str(p.hora) : '',
  }
}
