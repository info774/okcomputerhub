// Datos y reglas comunes de Mantenimientos (portadas de la app):
//   · mant-estados.js: quién cobra una sede (Stripe, la Zoho Billing vieja o
//     nadie), si ya cobra y la cuota NETA (la cartera heredada de Zoho guarda el
//     importe en BRUTO, con el IGIC dentro). Si cambian allí, cambiarlas aquí.
//   · El estado de las copias de seguridad y de las revisiones del plan en el
//     periodo actual (_loadBackupEstadoForMant de la app).
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { periodoKey } from '../sitios/equipamiento';

export interface Sede {
  id: string; nombre: string; cliente_id: string | null; plan: string | null; estado_pago: string | null;
  frecuencia_pago: string | null; forma_pago: string | null; proxima_cuota: string | null; fecha_activacion: string | null;
  zoho_subscription_id: string | null; zoho_estado: string | null; stripe_subscription_id: string | null; stripe_mandato_estado: string | null;
  stripe_cobro_en_curso_at: string | null; stripe_ultimo_error: string | null; programa_tpv: string | null;
  cert_caducidad: string | null; backup_tipo: string | null; backup_destino: string | null; backup_comprobado: string | null;
  control_horario: boolean | null; control_horario_sistema: string | null; control_horario_nuestro: boolean | null; codigo_verificacion: string | null;
  importe_mantenimiento?: number | null; importe_incluye_impuesto?: boolean | null; zoho_deuda?: number | null; zoho_sync_error?: string | null;
}
export type Pasarela = 'stripe' | 'espera' | 'zoho' | 'nadie';
export interface Telefono { id: string; local_id: string; nombre: string | null; numero: string; rol: string | null }

export const IGIC = 7;
export const ZOHO_MUERTA = new Set(['cancelled', 'expired', 'cancelled_from_dunning', 'no_existe']);
// Stripe pone «Ultimo aviso» sin tilde y Zoho «Último aviso»: comparar siempre sin acentos.
export const sinAcentos = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const PAGO_MAL = ['ultimo aviso', 'no paga'];
export const TORCIDO = ['pendiente de pago', ...PAGO_MAL];
export const esTorcido = (s: Pick<Sede, 'estado_pago'>) => TORCIDO.includes(sinAcentos(s.estado_pago));
export const SIN_PLAN = (p: string | null | undefined) => !p || p === 'Sin mantenimiento';

export const sedeEnZoho = (s: Pick<Sede, 'zoho_subscription_id' | 'stripe_subscription_id' | 'zoho_estado'>) =>
  !!s.zoho_subscription_id && !s.stripe_subscription_id && !ZOHO_MUERTA.has((s.zoho_estado ?? '').toLowerCase());
export const sedeYaCobra = (s: Pick<Sede, 'zoho_subscription_id' | 'stripe_subscription_id' | 'zoho_estado' | 'stripe_mandato_estado'>) =>
  s.stripe_subscription_id ? s.stripe_mandato_estado === 'activo' : sedeEnZoho(s);
export const sedeEsperandoPago = (s: Pick<Sede, 'zoho_subscription_id' | 'stripe_subscription_id' | 'zoho_estado' | 'stripe_mandato_estado'>) =>
  !sedeEnZoho(s) && !!s.stripe_subscription_id && s.stripe_mandato_estado !== 'activo';
export const pasarela = (s: Sede): Pasarela => s.stripe_subscription_id ? (s.stripe_mandato_estado === 'activo' ? 'stripe' : 'espera') : sedeEnZoho(s) ? 'zoho' : 'nadie';
/** netoSede de la app: la cuota NETA mensual (quita el IGIC a la cartera heredada de Zoho). */
export function netoMensual(s: Pick<Sede, 'importe_mantenimiento' | 'importe_incluye_impuesto'>): number {
  const g = Number(s.importe_mantenimiento ?? 0);
  return !g || !s.importe_incluye_impuesto ? g : Math.round(g / (1 + IGIC / 100) * 100) / 100;
}
export const FRECUENCIAS: [string, number][] = [['Mensual', 1], ['Trimestral', 3], ['Semestral', 6], ['Anual', 12]];
export const mesesDe = (f: string | null | undefined) => FRECUENCIAS.find(([k]) => k.toLowerCase() === (f ?? '').trim().toLowerCase())?.[1] ?? 1;
export const normalizaFrecuencia = (f: string | null | undefined) => FRECUENCIAS.find(([k]) => k.toLowerCase() === (f ?? '').trim().toLowerCase())?.[0] ?? null;

export const COLS_SEDE = `id,nombre,cliente_id,plan,estado_pago,frecuencia_pago,forma_pago,proxima_cuota,fecha_activacion,zoho_subscription_id,zoho_estado,
  stripe_subscription_id,stripe_mandato_estado,stripe_cobro_en_curso_at,stripe_ultimo_error,programa_tpv,cert_caducidad,backup_tipo,backup_destino,
  backup_comprobado,control_horario,control_horario_sistema,control_horario_nuestro,codigo_verificacion,zoho_sync_error`.replace(/\s+/g, '');
export const colsSede = () => COLS_SEDE + (esAdmin() ? ',importe_mantenimiento,importe_incluye_impuesto,zoho_deuda' : '');

/** Por sede: copias de seguridad ('sin_backup' | 'al_dia' | 'pendiente') y revisiones ('sin' | 'al_dia' | 'atrasada') del periodo actual. */
export async function estadosDelPlan(sedes: Sede[]): Promise<{ backup: Map<string, string>; revision: Map<string, string> }> {
  const [tareas, hechos] = await Promise.all([
    API.get<{ id: string; plan: string; periodicidad: string; es_backup: boolean }[]>('plan_tareas', { select: 'id,plan,periodicidad,es_backup', activa: 'eq.true' }),
    API.fetchAll<{ local_id: string; tarea_id: string; periodo: string }>('sitio_tarea_seguimiento', { select: 'local_id,tarea_id,periodo' }),
  ]);
  const hecho = new Set((hechos.data ?? []).map(h => `${h.local_id}|${h.tarea_id}|${h.periodo}`));
  const backup = new Map<string, string>(), revision = new Map<string, string>();
  for (const s of sedes) {
    const del = (tareas.data ?? []).filter(t => t.plan === s.plan);
    const cumple = (ts: typeof del) => ts.every(t => hecho.has(`${s.id}|${t.id}|${periodoKey(t.periodicidad)}`));
    const bk = del.filter(t => t.es_backup), rv = del.filter(t => !t.es_backup);
    backup.set(s.id, !bk.length ? 'sin_backup' : cumple(bk) ? 'al_dia' : 'pendiente');
    revision.set(s.id, !rv.length ? 'sin' : cumple(rv) ? 'al_dia' : 'atrasada');
  }
  return { backup, revision };
}

/** Días hasta una fecha (negativo = ya pasó), a mediodía para no perder uno por la hora. */
export const diasHasta = (f: string | null | undefined) => {
  if (!f) return null;
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  return Math.round((new Date(`${f.slice(0, 10)}T12:00:00`).getTime() - hoy.getTime()) / 86_400_000);
};
export const fechaCorta = (f: string | null | undefined) => f ? new Date(`${f.slice(0, 10)}T12:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
export const ROLES_SENSIBLES = ['dueno', 'administracion'];
/** Texto del código para mandarlo (enviarCodigoWa / enviarCodigoEmail de la app). */
export const textoCodigo = (local: string, codigo: string) =>
  `Hola. Le enviamos el código de verificación de ${local}: ${codigo}\n\nSe lo pediremos por WhatsApp antes de enviarle facturas, presupuestos o información de su contrato. Guárdelo y no lo comparta.\n\nOk Computer Tenerife`;
