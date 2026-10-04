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

// ── Contratos (mantenimientos.js de la app) ─────────────────────────────────
export interface Contrato {
  id: string; token: string; created_at: string; plan_nombre: string; cliente_id: string | null; local_id: string | null; contacto_id: string | null;
  cliente_nombre: string | null; cliente_nif: string | null; direccion: string | null; municipio: string | null; precio_mensual: number | null;
  frecuencia_pago: string | null; estado: string; firmante_nombre: string | null; firmado_at: string | null; mandato_estado: string | null;
  servicios: { incluidos?: string[]; no_incluidos?: string[] } | null; tarifa_estandar: number | null; tarifa_urgente: number | null;
  fecha_inicio: string | null; vigencia_meses: number | null; renovacion_automatica: boolean | null; renovacion_avisada_at: string | null;
}
// Sin cuerpo_html ni firma_img (pesan): se piden al abrir un contrato.
export const COLS_CONTRATO = 'id,token,created_at,plan_nombre,cliente_id,local_id,contacto_id,cliente_nombre,cliente_nif,direccion,municipio,precio_mensual,'
  + 'frecuencia_pago,estado,firmante_nombre,firmado_at,mandato_estado,servicios,tarifa_estandar,tarifa_urgente,fecha_inicio,vigencia_meses,renovacion_automatica,renovacion_avisada_at';

/** El contrato que le toca a una sede: el PENDIENTE de firma y, si no, el último firmado (lista por fecha desc); los anulados no cuentan. */
export function contratoDeSede<T extends Pick<Contrato, 'local_id' | 'estado'>>(contratos: T[], localId: string | null): T | null {
  if (!localId) return null;
  const suyos = contratos.filter(c => c.local_id === localId && c.estado !== 'anulado');
  return suyos.find(c => c.estado === 'pendiente') ?? suyos.find(c => c.estado === 'firmado') ?? null;
}

export const RENOV_AVISO_DIAS = 60;    // los dos meses de antelación
export const RENOV_PREAVISO_DIAS = 30; // lo que pide la cláusula 18 para no renovar

// Fechas ISO sin pasar por el huso: 31 de enero + 1 mes es el 28 (o 29).
export function sumaMeses(iso: string, meses: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (m - 1) + meses;
  const ny = y + Math.floor(total / 12), nm = (total % 12 + 12) % 12 + 1;
  const ultimo = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}
export function diasEntre(desde: string, hasta: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(hasta) - p(desde)) / 86_400_000);
}
export function restaDias(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}
export const hoyIso = () => new Date().toLocaleDateString('sv-SE');

export interface Renovacion { inicio: string; fecha: string; periodo: number; dias: number; preaviso: string; auto: boolean; avisado: boolean }
/** El periodo en curso de un contrato FIRMADO: cuándo acaba, qué año va y hasta cuándo se puede decir que no. La fecha no se guarda: es el aniversario de la firma. */
export function renovacionDe(c: Pick<Contrato, 'estado' | 'fecha_inicio' | 'firmado_at' | 'vigencia_meses' | 'renovacion_automatica' | 'renovacion_avisada_at'> | null): Renovacion | null {
  if (!c || c.estado !== 'firmado') return null;
  const inicio = c.fecha_inicio || (c.firmado_at ?? '').slice(0, 10) || null;
  if (!inicio) return null;
  const meses = Math.max(1, Number(c.vigencia_meses) || 12);
  const hoy = hoyIso();
  let periodo = 1, fecha = sumaMeses(inicio, meses);
  while (fecha <= hoy && periodo < 200) { periodo++; fecha = sumaMeses(inicio, meses * periodo); }
  return { inicio, fecha, periodo, dias: diasEntre(hoy, fecha), preaviso: restaDias(fecha, RENOV_PREAVISO_DIAS), auto: c.renovacion_automatica !== false, avisado: !!c.renovacion_avisada_at };
}

/** El contrato que manda en cada sede: el ÚLTIMO firmado (lista por fecha desc); sin sede, cada uno aparte. */
export function contratosVigentes<T extends Pick<Contrato, 'id' | 'local_id' | 'estado'>>(contratos: T[]): T[] {
  const vistos = new Set<string>();
  return contratos.filter(c => {
    if (c.estado !== 'firmado') return false;
    const k = c.local_id ?? `sin-sede:${c.id}`;
    if (vistos.has(k)) return false;
    vistos.add(k); return true;
  });
}

/** Lo que entra en renovación en los próximos 60 días (sin las sedes de baja), por fecha. */
export function renovacionesProximas<T extends Contrato>(contratos: T[], sedeDeBaja: (localId: string | null) => boolean) {
  return contratosVigentes(contratos).map(c => ({ c, r: renovacionDe(c)! })).filter(x => x.r && x.r.dias <= RENOV_AVISO_DIAS && !sedeDeBaja(x.c.local_id))
    .sort((a, b) => a.r.fecha.localeCompare(b.r.fecha));
}

/** Lo que se le cobra por periodo con el IGIC (los precios son NETOS y mensuales). */
export const cuotaPeriodo = (netoMes: number, frecuencia: string | null | undefined) => {
  const meses = mesesDe(frecuencia);
  return { meses, neto: netoMes * meses, bruto: Math.round(netoMes * meses * (1 + IGIC / 100) * 100) / 100 };
};

// La suscripción en el panel de Zoho Billing. La cuenta de Billing es la
// misma organización que Zoho Books (en la app iba escrita a mano en cada enlace).
export const ZOHO_BILLING_CUENTA = '20107733530';
export const urlZohoBilling = (id: string | null | undefined) => `https://billing.zoho.eu/app/${ZOHO_BILLING_CUENTA}#/subscriptions/${encodeURIComponent(id ?? '')}`;
