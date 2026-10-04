// deno-lint-ignore-file no-explicit-any
// Portado LITERAL de okcomputerclaude (_shared/soporte-horario.ts): si cambian
// las reglas allí, cambiarlas aquí. En el hub, planes_mantenimiento es espejo y
// festivos es la tabla propia del Desk (la misma que usa el SLA).
// ¿Cubre ahora el mantenimiento de un local el soporte que pide el cliente?
// Lo usa el menú de WhatsApp (`whatsapp-webhook`): el cliente dice el local, se
// mira su plan (`locales.plan` → `planes_mantenimiento.horario_soporte`) y si
// la hora de Canarias cae dentro de una franja contratada. Los festivos
// (tabla `festivos`) cuentan como fuera de horario para todos los planes.

// supabase-js sobre el esquema `hub` (dbHub de sb-hub.ts); `any` como en el resto del código portado.
type SupabaseClient = any

const ZONA = 'Atlantic/Canary'
const NOMBRE_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

export interface Cobertura {
  plan: string
  conMantenimiento: boolean
  dentroHorario: boolean
  festivo?: string
  // «L–V 09:00–17:00 · sáb y dom 11:00–15:00», para contárselo al cliente.
  horarioTexto: string
}

// Fecha (AAAA-MM-DD), día ISO (1 = lunes) y hora (HH:MM) en Canarias.
export function ahoraCanarias(d = new Date()): { fecha: string; dia: number; hora: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d).map(x => [x.type, x.value]))
  const dias: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  return { fecha: `${p.year}-${p.month}-${p.day}`, dia: dias[p.weekday] ?? 1, hora: `${p.hour}:${p.minute}` }
}

type Franjas = Record<string, [string, string]>

export function textoHorario(dias: Franjas): string {
  const grupos: { desde: number; hasta: number; franja: string }[] = []
  for (let d = 1; d <= 7; d++) {
    const f = dias[String(d)]
    if (!f) continue
    const franja = `${f[0]}–${f[1]}`
    const ult = grupos[grupos.length - 1]
    if (ult && ult.franja === franja && ult.hasta === d - 1) ult.hasta = d
    else grupos.push({ desde: d, hasta: d, franja })
  }
  const corto = (d: number) => NOMBRE_DIA[d].slice(0, 3)
  return grupos.map(g => {
    const dias = g.desde === g.hasta ? NOMBRE_DIA[g.desde]
      : g.hasta === g.desde + 1 ? `${corto(g.desde)} y ${corto(g.hasta)}`
      : `${corto(g.desde)} a ${corto(g.hasta)}`
    return `${dias} ${g.franja}`
  }).join(' · ')
}

export function cubre(dias: Franjas | null | undefined, momento: { dia: number; hora: string }): boolean {
  const f = dias?.[String(momento.dia)]
  return !!f && momento.hora >= f[0] && momento.hora < f[1]
}

export async function coberturaDeLocal(db: SupabaseClient, planLocal: string | null, cuando = new Date()): Promise<Cobertura> {
  const plan = (planLocal || 'Sin mantenimiento').trim()
  const ahora = ahoraCanarias(cuando)
  const [{ data: p }, { data: fest }] = await Promise.all([
    db.from('planes_mantenimiento').select('nombre, horario_soporte').ilike('nombre', plan).maybeSingle(),
    db.from('festivos').select('nombre').eq('fecha', ahora.fecha).maybeSingle(),
  ])
  const dias: Franjas | null = p?.horario_soporte?.dias ?? null
  const conMantenimiento = !!dias && Object.keys(dias).length > 0
  return {
    plan: p?.nombre ?? plan,
    conMantenimiento,
    festivo: fest?.nombre,
    dentroHorario: conMantenimiento && !fest && cubre(dias, ahora),
    horarioTexto: dias ? textoHorario(dias) : '',
  }
}
