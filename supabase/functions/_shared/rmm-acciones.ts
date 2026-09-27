// Lo que el hub puede pedirle a Breeze sobre un equipo. Catálogo ÚNICO para la
// pantalla Monitorización (función breeze-api) y el conector MCP: lista blanca
// de acciones, comprobación de que el equipo/alerta/script existe (en las
// vistas hub.rmm_*) y una fila en hub.rmm_acciones por cada petición, salga
// bien o mal, a nombre de quien la pidió.
import { type Db, esUuid } from './hub-db.ts'
import { breeze, breezeConfigurado } from './breeze.ts'

// Comandos de Breeze que se ofrecen (POST /devices/:id/commands). Breeze admite
// más (update, collect_evidence, execute_containment…): no se abren aquí.
export const COMANDOS: Record<string, string> = {
  refresh_inventory: 'Refrescar inventario',
  reboot: 'Reiniciar',
  shutdown: 'Apagar',
  wake: 'Encender (Wake-on-LAN)',
}

export type AccionRmm =
  | { accion: 'acusar_alerta'; alerta_id: string }
  | { accion: 'comando'; device_id: string; tipo: string }
  | { accion: 'script'; script_id: string; device_ids: string[]; parametros?: Record<string, unknown> }

export interface Quien { usuarioId: string | null; email: string }

function validar(a: AccionRmm): AccionRmm {
  switch (a?.accion) {
    case 'acusar_alerta':
      if (!esUuid(a.alerta_id)) throw new Error('alerta_id no válido')
      return { accion: a.accion, alerta_id: a.alerta_id }
    case 'comando':
      if (!esUuid(a.device_id)) throw new Error('device_id no válido')
      if (!(a.tipo in COMANDOS)) throw new Error(`Comando no permitido. Valen: ${Object.keys(COMANDOS).join(', ')}`)
      return { accion: a.accion, device_id: a.device_id, tipo: a.tipo }
    case 'script': {
      if (!esUuid(a.script_id)) throw new Error('script_id no válido')
      const ids = Array.isArray(a.device_ids) ? [...new Set(a.device_ids)] : []
      if (!ids.length || ids.length > 50 || !ids.every(esUuid)) throw new Error('device_ids: de 1 a 50 equipos')
      const p = a.parametros ?? {}
      if (typeof p !== 'object' || Array.isArray(p) || JSON.stringify(p).length > 8000) throw new Error('parametros no válidos')
      return { accion: a.accion, script_id: a.script_id, device_ids: ids, parametros: p }
    }
    default:
      throw new Error('Acción desconocida (acusar_alerta, comando, script)')
  }
}

// Ejecuta la acción y la apunta. Devuelve lo que contestó Breeze (resumido).
export async function ejecutarAccionRmm(db: Db, quien: Quien, entrada: AccionRmm): Promise<Record<string, unknown>> {
  const a = validar(entrada)
  if (!breezeConfigurado()) throw new Error('Falta el usuario de servicio de Breeze (BREEZE_HUB_EMAIL / BREEZE_HUB_PASSWORD): ver docs/FASE2.md')
  const fila: Record<string, unknown> = {
    usuario_id: quien.usuarioId, usuario_email: quien.email, accion: a.accion, detalle: {},
  }
  let respuesta: Record<string, unknown> = {}
  try {
    if (a.accion === 'acusar_alerta') {
      const [al] = await db.get(`rmm_alertas?select=id,device_id,estado,titulo&id=eq.${a.alerta_id}`)
      if (!al) throw new Error('No existe esa alerta')
      fila.alerta_id = a.alerta_id
      fila.device_ids = al.device_id ? [al.device_id] : []
      fila.detalle = { titulo: al.titulo }
      if (al.estado !== 'active') throw new Error(`La alerta ya está «${al.estado}»`)
      const r = await breeze('POST', `/alerts/${a.alerta_id}/acknowledge`) as Record<string, unknown>
      respuesta = { estado: r?.status ?? 'acknowledged' }
    } else if (a.accion === 'comando') {
      const [eq] = await db.get(`rmm_equipos?select=id,hostname&id=eq.${a.device_id}`)
      if (!eq) throw new Error('No existe ese equipo')
      fila.device_ids = [a.device_id]
      fila.detalle = { tipo: a.tipo, hostname: eq.hostname }
      const r = await breeze('POST', `/devices/${a.device_id}/commands`, { type: a.tipo }) as Record<string, unknown>
      respuesta = { id: r?.id, estado: r?.status, entrega: r?.delivery }
    } else {
      const [sc] = await db.get(`rmm_scripts?select=id,nombre&id=eq.${a.script_id}`)
      if (!sc) throw new Error('No existe ese script')
      const equipos = await db.get(`rmm_equipos?select=id,hostname&id=in.(${a.device_ids.join(',')})`)
      if (equipos.length !== a.device_ids.length) throw new Error('Algún equipo no existe')
      fila.device_ids = a.device_ids
      fila.detalle = { script: sc.nombre, equipos: equipos.map(e => e.hostname), parametros: a.parametros }
      const r = await breeze('POST', `/scripts/${a.script_id}/execute`, {
        deviceIds: a.device_ids, parameters: a.parametros, triggerType: 'manual',
      }) as { targets?: { requestedDeviceId: string; admission: string; executionId?: string; delivery?: string; reasonCode?: string }[] }
      respuesta = {
        equipos: (r?.targets ?? []).map(t => ({
          device_id: t.requestedDeviceId, admitido: t.admission === 'admitted', ejecucion_id: t.executionId ?? null,
          entrega: t.delivery ?? null, motivo: t.reasonCode ?? null,
        })),
      }
    }
    await db.post('rmm_acciones', { ...fila, estado: 'ok', respuesta })
    return { ok: true, ...respuesta }
  } catch (e) {
    const msg = (e as Error).message
    await db.post('rmm_acciones', { ...fila, estado: 'error', error: msg.slice(0, 1000) })
      .catch(err => console.error('[rmm] no se pudo apuntar la acción:', err))
    throw e
  }
}
