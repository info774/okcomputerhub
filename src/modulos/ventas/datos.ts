// Ventas (fase 4): lo común a Clientes 360, Oportunidades, Cobros y Mapa.
// Clientes, sedes y contactos son ESPEJO de la app (solo lectura aquí); lo
// que escribe el hub es suyo: actividades, clientes_crm, oportunidades,
// pipelines y el estado de los recordatorios de cobro.
import { API } from '../../core/api';
import { APP_ACTUAL_URL } from '../../core/config';

export interface Cliente { id: string; nombre: string; nif: string | null; telefono: string | null; email: string | null;
  direccion: string | null; estado: string | null; zoho_id: string | null; notas: string | null; tipo: string | null; activo: boolean | null }
export interface Crm { cliente_id: string; clase_manual: 'A' | 'B' | 'C' | null; siguiente_fecha: string | null; siguiente_texto: string | null;
  responsable_id: string | null; etiquetas: string[] }
export interface Clase { cliente_id: string; clase: 'A' | 'B' | 'C'; clase_auto: 'A' | 'B' | 'C' }
export interface Etapa { clave: string; nombre: string; probabilidad: number; tipo: 'abierta' | 'ganada' | 'perdida' }
export interface Pipeline { id: string; nombre: string; etapas: Etapa[]; por_defecto: boolean; orden: number; activo: boolean }
export interface Oportunidad { id: string; created_at: string; titulo: string; cliente_id: string | null; descripcion: string | null;
  estado: string; valor_estimado: number | null; tecnico_id: string | null; fecha_seguimiento: string | null; motivo_perdida: string | null;
  origen: string | null; local_id: string | null; contacto_id: string | null; pipeline_id: string; orden: number; cerrada_at: string | null }
export interface Evento { fecha: string | null; tipo: string; titulo: string; detalle: string | null; importe: number | null;
  enlace: string | null; autor: string | null; ref_id: string }

export const TIPOS_ACTIVIDAD: Record<string, { nombre: string; icono: string }> = {
  nota: { nombre: 'Nota', icono: '📝' }, llamada: { nombre: 'Llamada', icono: '📞' }, visita: { nombre: 'Visita', icono: '🚗' },
  email: { nombre: 'Email', icono: '✉️' }, whatsapp: { nombre: 'WhatsApp', icono: '💬' }, reunion: { nombre: 'Reunión', icono: '🤝' },
};
export const ICONO_EVENTO: Record<string, string> = {
  trabajo: '🛠', ticket: '🎫', presupuesto: '📄', oportunidad: '🎯', factura: '💶', cobro: '✅',
  ...Object.fromEntries(Object.entries(TIPOS_ACTIVIDAD).map(([k, v]) => [`actividad_${k}`, v.icono])),
};
export const ORIGENES = ['web', 'whatsapp', 'teléfono', 'recomendación', 'visita', 'cliente actual', 'otro'];
export const CLASE_TONO: Record<string, string> = { A: 'bien', B: 'aviso', C: 'neutro' };

export const enApp = () => APP_ACTUAL_URL;
export const eur = (n: number | string | null | undefined, dec = 0) =>
  `${Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })} €`;

// Texto seguro para filtros de PostgREST.
export const limpio = (s: string) => s.replace(/[*,()%\\]/g, ' ').trim().slice(0, 80);

// Clases A/B/C de todos los clientes (una carga en vuelo, caché 5 min).
let _clases: Map<string, Clase> | null = null, _clasesAt = 0, _clasesVuelo: Promise<Map<string, Clase>> | null = null;
export function clases(): Promise<Map<string, Clase>> {
  if (_clases && Date.now() - _clasesAt < 5 * 60_000) return Promise.resolve(_clases);
  return (_clasesVuelo ??= API.rpc<Clase[]>('clases_clientes').then(r => {
    _clasesAt = Date.now();
    _clases = new Map((r.data ?? []).map(c => [c.cliente_id, c]));
    return _clases;
  }).finally(() => { _clasesVuelo = null; }));
}
export const olvidarClases = () => { _clasesAt = 0; };

export async function pipelines(): Promise<Pipeline[]> {
  const { data } = await API.get<Pipeline[]>('pipelines', { select: '*', activo: 'eq.true', order: 'por_defecto.desc,orden,nombre' });
  return data ?? [];
}

export async function buscarClientes(q: string, limite = 8) {
  const t = limpio(q);
  if (t.length < 2) return [];
  const { data } = await API.get<Cliente[]>('clientes', { select: 'id,nombre,nif,telefono', activo: 'eq.true',
    or: `(nombre.ilike.*${t}*,nif.ilike.*${t}*,telefono.ilike.*${t}*,email.ilike.*${t}*)`, order: 'nombre', limit: String(limite) });
  return data ?? [];
}

export async function nombresClientes(ids: (string | null)[]): Promise<Map<string, string>> {
  const u = [...new Set(ids.filter(Boolean))] as string[];
  if (!u.length) return new Map();
  const { data } = await API.get<{ id: string; nombre: string }[]>('clientes', { select: 'id,nombre', id: `in.(${u.join(',')})` });
  return new Map((data ?? []).map(c => [c.id, c.nombre]));
}

// Teléfono para wa.me: solo dígitos, con el 34 delante si es un número español de 9 cifras.
export function telWhatsApp(tel: string | null | undefined): string | null {
  const d = (tel ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 9 && /^[6789]/.test(d)) return `34${d}`;
  return d.replace(/^00/, '');
}
