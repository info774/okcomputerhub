// Los informes del hub: el mismo texto para el informe programado, el «Enviar
// ahora», la vista previa de la pantalla Informes y los comandos del bot.
// Todo sale de lo que el hub ya tiene: el motor de avisos
// (hub.panorama_direccion), el resumen de dinero (hub.direccion_resumen, solo
// admins), las vistas hub.rmm_* y las tablas espejo. Texto en el HTML de
// Telegram.
import type { Db, Fila } from './hub-db.ts'
import { h } from './mensajeria.ts'

export interface Persona { id: string; nombre: string; email: string; rol: string }

export const TIPOS: Record<string, { nombre: string; dinero: boolean; comando: string }> = {
  avisos: { nombre: 'Avisos pendientes', dinero: false, comando: 'avisos' },
  repaso_matinal: { nombre: 'Repaso de la mañana', dinero: false, comando: 'repaso' },
  cierre_dia: { nombre: 'Cierre del día', dinero: false, comando: 'cierre' },
  resumen_rmm: { nombre: 'Resumen de monitorización', dinero: false, comando: 'rmm' },
  estado_proyectos: { nombre: 'Estado de los proyectos', dinero: false, comando: 'proyectos' },
  cobros_vencidos: { nombre: 'Cobros vencidos', dinero: true, comando: 'cobros' },
  ventas_ayer: { nombre: 'Ventas de ayer', dinero: true, comando: 'ventas' },
}

const HUB = 'https://okhub-tenerife.web.app/'
const eur = (n: unknown) => `${Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
export const hoyCanarias = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Canary' })
// Inicio y fin del día de hoy en Canarias (UTC+0 en invierno, +1 en verano).
export function limitesHoy(): { ini: string; fin: string } {
  const hoy = hoyCanarias()
  const u = new Date(`${hoy}T12:00:00Z`)
  const off = new Date(u.toLocaleString('en-US', { timeZone: 'Atlantic/Canary' })).getTime() - new Date(u.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  const ini = new Date(Date.parse(`${hoy}T00:00:00Z`) - off)
  return { ini: ini.toISOString(), fin: new Date(ini.getTime() + 86400000 - 1000).toISOString() }
}
const fechaLarga = () => new Date().toLocaleDateString('es-ES', { timeZone: 'Atlantic/Canary', weekday: 'long', day: 'numeric', month: 'long' })
const enlace = (e: unknown) => (typeof e === 'string' && e ? (e.startsWith('#') ? HUB + e : e) : '')
const lista = (filas: string[], max = 8) =>
  filas.slice(0, max).map(f => `• ${f}`).join('\n') + (filas.length > max ? `\n… y ${filas.length - max} más` : '')

const NOMBRE_AVISO: Record<string, string> = {
  presupuesto_sin_respuesta: '📄 Presupuestos sin respuesta', trabajo_sin_facturar: '🧾 Trabajos por facturar',
  ticket_sin_asignar: '🎫 Tickets sin asignar', alerta_rmm: '🚨 Alertas de equipos', sede_sin_conexion: '📡 Sedes sin conexión',
  hito_vencido: '🧭 Hitos vencidos', factura_vencida: '💶 Facturas vencidas', cobro_mantenimiento: '🔁 Cobros de mantenimiento',
  cliente_sin_comprar: '🤝 Clientes importantes sin comprar', cierre_mes: '📅 Cierre del mes',
}

// En la app el técnico se guarda por NOMBRE y no siempre igual («Matteo» /
// «Matteo Monastero»): vale el nombre completo o el de pila.
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
export function esDe(guardado: unknown, p: Persona): boolean {
  const g = norm(guardado), n = norm(p.nombre)
  return !!g && (g === n || g === n.split(/\s+/)[0])
}

async function avisos(db: Db, p: Persona): Promise<Fila[]> {
  return (await db.rpc('panorama_direccion', { p_para: p.id })) as Fila[] ?? []
}

function bloqueAvisos(filas: Fila[], max = 5): string {
  if (!filas.length) return '✅ Nada pendiente.'
  const grupos = new Map<string, Fila[]>()
  for (const f of filas) grupos.set(f.tipo as string, [...(grupos.get(f.tipo as string) ?? []), f])
  const orden = [...grupos.entries()].sort((a, b) =>
    (b[1].some(x => x.gravedad === 'mal') ? 1 : 0) - (a[1].some(x => x.gravedad === 'mal') ? 1 : 0) || b[1].length - a[1].length)
  return orden.map(([tipo, fs]) => {
    const suma = fs.reduce((s, f) => s + Number(f.importe ?? 0), 0)
    const cab = `<b>${h(NOMBRE_AVISO[tipo] ?? tipo)}</b> (${fs.length}${suma ? ` · ${eur(suma)}` : ''})`
    return `${cab}\n${lista(fs.map(f => {
      const url = enlace(f.enlace)
      const t = h(String(f.titulo).replace(/^[^:]+: /, ''))
      return `${url ? `<a href="${h(url)}">${t}</a>` : t}${f.detalle ? ` — ${h(f.detalle)}` : ''}${f.importe ? ` · ${eur(f.importe)}` : ''}`
    }), max)}`
  }).join('\n\n')
}

async function informeAvisos(db: Db, p: Persona) {
  const a = await avisos(db, p)
  return `🔔 <b>Avisos pendientes</b> · ${h(fechaLarga())}\n\n${bloqueAvisos(a)}`
}

async function repasoMatinal(db: Db, p: Persona) {
  const hoy = hoyCanarias()
  const { ini, fin } = limitesHoy()
  const [agenda, tickets, tareas, a] = await Promise.all([
    db.get(`agenda?select=titulo,inicio,fin,trabajo_id,ticket_id,tecnicos&inicio=lte.${fin}&fin=gte.${ini}&order=inicio`),
    db.get(`tickets?select=numero,titulo,prioridad,tecnico_id&estado=in.(Abierto,"En curso")&order=created_at`).then(ts => ts.filter(t => esDe(t.tecnico_id, p))),
    db.get(`proyecto_tareas?select=titulo,fecha_limite,proyecto_id&responsable_id=eq.${p.id}&estado=neq.hecho&fecha_limite=lte.${hoy}&order=fecha_limite`),
    avisos(db, p),
  ])
  const mia = agenda.filter(b => !Array.isArray(b.tecnicos) || !(b.tecnicos as string[]).length || (b.tecnicos as string[]).some(t => esDe(t, p)))
  const hora = (v: unknown) => new Date(v as string).toLocaleTimeString('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit' })
  const partes = [`☀️ <b>Buenos días, ${h(p.nombre)}</b> · ${h(fechaLarga())}`]
  partes.push(`<b>📅 Tu agenda de hoy</b>\n${mia.length ? lista(mia.map(b => `${hora(b.inicio)} ${h(b.titulo ?? 'Sin título')}`), 12) : 'Nada programado.'}`)
  if (tickets.length) partes.push(`<b>🎫 Tus tickets abiertos</b>\n${lista(tickets.map(t => `#${t.numero} ${h(t.titulo)}${t.prioridad ? ` (${h(t.prioridad)})` : ''}`))}`)
  if (tareas.length) partes.push(`<b>🧭 Tareas de proyecto para hoy o atrasadas</b>\n${lista(tareas.map(t => `${h(t.titulo)} · ${h(t.fecha_limite)}`))}`)
  const mios = a.filter(x => esDe(x.persona, p))
  const deDinero = a.filter(x => x.dinero)
  if (mios.length) partes.push(`<b>🔔 Avisos tuyos</b>\n${bloqueAvisos(mios, 4)}`)
  if (p.rol === 'admin') {
    const sinDueno = a.filter(x => !x.persona && !x.dinero)
    partes.push(`<b>🏢 Del equipo</b>: ${sinDueno.length} aviso(s)${deDinero.length ? ` · 💶 ${deDinero.length} de dinero (${eur(deDinero.reduce((s, f) => s + Number(f.importe ?? 0), 0))})` : ''}. /avisos para verlos.`)
  }
  return partes.join('\n\n')
}

async function cierreDia(db: Db, _p: Persona) {
  const hoy = hoyCanarias()
  const { ini } = limitesHoy()
  const [sesiones, programados] = await Promise.all([
    db.get(`sesiones?select=tecnico_nombre,duracion_min,inicio,fin&inicio=gte.${ini}`),
    db.get(`trabajos?select=numero,titulo,estado&fecha_programada=eq.${hoy}&order=numero`),
  ])
  const horas = new Map<string, number>()
  for (const s of sesiones) horas.set(String(s.tecnico_nombre ?? '¿?'), (horas.get(String(s.tecnico_nombre ?? '¿?')) ?? 0) + Number(s.duracion_min ?? 0))
  const abiertas = sesiones.filter(s => s.inicio && !s.fin).length
  const hechos = programados.filter(t => ['Completado', 'Para facturar', 'Facturado'].includes(t.estado as string))
  return [`🌙 <b>Cierre del día</b> · ${h(fechaLarga())}`,
    `<b>⏱ Horas fichadas</b>\n${horas.size ? lista([...horas].map(([n, m]) => `${h(n)}: ${Math.floor(m / 60)} h ${m % 60} min`), 12) : 'Nadie ha fichado hoy.'}${abiertas ? `\n⚠️ ${abiertas} fichaje(s) siguen abiertos.` : ''}`,
    `<b>🛠 Trabajos de hoy</b>: ${hechos.length} de ${programados.length} terminados${programados.length > hechos.length
      ? `\n${lista(programados.filter(t => !hechos.includes(t)).map(t => `#${t.numero} ${h(t.titulo ?? '')} · ${h(t.estado)}`))}` : ''}`,
  ].join('\n\n')
}

async function resumenRmm(db: Db, _p: Persona) {
  const [equipos, alertas] = await Promise.all([
    db.get('rmm_equipos?select=nombre,sitio,local_id,conectado,visto_ultimo,discos,parches_pendientes'),
    db.get('rmm_alertas?select=titulo,severidad,hostname&estado=eq.active&order=disparada.desc'),
  ])
  const con = equipos.filter(e => e.conectado).length
  const sin = equipos.filter(e => !e.conectado)
  // deno-lint-ignore no-explicit-any
  const llenos = equipos.filter(e => ((e.discos as any[]) ?? []).some(d => d.total_gb > 2 && d.uso >= 90))
  const partes = [`🖥 <b>Monitorización</b> · ${con} de ${equipos.length} equipos conectados`]
  if (alertas.length) partes.push(`<b>🚨 Alertas activas</b>\n${lista(alertas.map(a => `${h(a.titulo)} · ${h(a.hostname ?? '')} (${h(a.severidad)})`))}`)
  if (sin.length) partes.push(`<b>📡 Sin conexión</b>\n${lista(sin.map(e => `${h(e.nombre)} · ${h(e.sitio ?? '')} · visto ${h(new Date(e.visto_ultimo as string).toLocaleDateString('es-ES'))}`))}`)
  if (llenos.length) partes.push(`<b>💽 Disco al 90 % o más</b>\n${lista(llenos.map(e => h(e.nombre)))}`)
  partes.push(`<a href="${HUB}#/monitorizacion">Abrir Monitorización</a>`)
  return partes.join('\n\n')
}

async function estadoProyectos(db: Db, _p: Persona) {
  const hoy = hoyCanarias()
  const [proyectos, tareas, hitos] = await Promise.all([
    db.get('proyectos?select=id,numero,titulo,estado,fecha_objetivo&estado=neq.cerrado&order=numero'),
    db.get(`proyecto_tareas?select=proyecto_id&estado=neq.hecho&fecha_limite=lt.${hoy}`),
    db.get(`proyecto_hitos?select=proyecto_id,nombre&estado=neq.hecho&fecha_objetivo=lt.${hoy}`),
  ])
  if (!proyectos.length) return '🧭 <b>Proyectos</b>\n\nNo hay proyectos abiertos.'
  const fases = ['idea', 'definicion', 'investigacion', 'roadmap', 'desarrollo']
  return [`🧭 <b>Proyectos abiertos</b>: ${proyectos.length}`,
    ...fases.map(f => {
      const ps = proyectos.filter(p => p.estado === f)
      return ps.length ? `<b>${h(f[0].toUpperCase() + f.slice(1))}</b>\n${lista(ps.map(p => {
        const tv = tareas.filter(t => t.proyecto_id === p.id).length, hv = hitos.filter(x => x.proyecto_id === p.id).length
        return `<a href="${HUB}#/proyectos/${p.numero}">#${p.numero} ${h(p.titulo)}</a>${tv ? ` · ⚠️ ${tv} tarea(s) atrasada(s)` : ''}${hv ? ` · ${hv} hito(s) vencido(s)` : ''}`
      }), 10)}` : ''
    }).filter(Boolean)].join('\n\n')
}

async function cobrosVencidos(db: Db, _p: Persona) {
  const hoy = hoyCanarias()
  const fs = await db.get(`zoho_facturas?select=invoice_id,numero,cliente_nombre,vence,saldo&saldo=gt.0&vence=lt.${hoy}&estado=not.in.(void,draft,paid)&order=saldo.desc`)
  if (!fs.length) return '💶 <b>Cobros vencidos</b>\n\n✅ Ninguna factura vencida.'
  const total = fs.reduce((s, f) => s + Number(f.saldo), 0)
  return `💶 <b>Cobros vencidos</b>: ${fs.length} factura(s) · ${eur(total)}\n\n${lista(fs.map(f =>
    `<a href="https://books.zoho.eu/app/20107733530#/invoices/${h(f.invoice_id)}">${h(f.numero)}</a> ${h(f.cliente_nombre)} · ${eur(f.saldo)} · venció ${h(f.vence)}`), 15)}`
}

async function ventasAyer(db: Db, p: Persona) {
  const ayer = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Canary' })
  const [fs, cs, r] = await Promise.all([
    db.get(`zoho_facturas?select=numero,cliente_nombre,total&fecha=eq.${ayer}&estado=not.in.(void,draft)&order=total.desc`),
    db.get(`zoho_cobros?select=importe&fecha=eq.${ayer}`),
    db.rpc('direccion_resumen', { p_para: p.id }) as Promise<Fila | null>,
  ])
  const suma = fs.reduce((s, f) => s + Number(f.total), 0), cobrado = cs.reduce((s, c) => s + Number(c.importe), 0)
  const partes = [`📈 <b>Ventas de ayer</b> (${h(ayer)}): ${fs.length} factura(s) · ${eur(suma)} · cobrado ${eur(cobrado)}`]
  if (fs.length) partes.push(lista(fs.map(f => `${h(f.numero)} ${h(f.cliente_nombre)} · ${eur(f.total)}`)))
  if (r) partes.push(`<b>En lo que va de mes</b>: ${eur(r.facturado_mes)} (el año pasado a estas alturas: ${eur(r.facturado_mes_anterior_ano)}) · pendiente de cobro ${eur(r.pendiente)}, vencido ${eur(r.vencido)}`)
  return partes.join('\n\n') + '\n\n<i>Importes con impuestos, como en Zoho.</i>'
}

const CONSTRUCTORES: Record<string, (db: Db, p: Persona) => Promise<string>> = {
  avisos: informeAvisos, repaso_matinal: repasoMatinal, cierre_dia: cierreDia, resumen_rmm: resumenRmm,
  estado_proyectos: estadoProyectos, cobros_vencidos: cobrosVencidos, ventas_ayer: ventasAyer,
}

export async function construirInforme(db: Db, tipo: string, p: Persona): Promise<string> {
  const t = TIPOS[tipo]
  if (!t) throw new Error(`Informe desconocido: ${tipo}`)
  if (t.dinero && p.rol !== 'admin') throw new Error('Ese informe es solo para administradores')
  return CONSTRUCTORES[tipo](db, p)
}
