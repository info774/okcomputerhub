// Monitorización: tipos y consultas sobre las vistas hub.rmm_* (lectura de
// Breeze, 20261006_rmm.sql) y la llamada a breeze-api para lo que se le PIDE a
// Breeze (acusar alerta, comando, script). Nunca se escribe en Breeze por la
// base: solo hub.rmm_sitios (qué sede es cada Site) es del hub.
import { API } from '../../core/api';
import { token } from '../../core/auth';
import { FUNCIONES_URL, SUPABASE_ANON_KEY, BREEZE_URL } from '../../core/config';

export interface Disco { unidad: string; total_gb: number; libre_gb: number; uso: number }
export interface Equipo {
  id: string; hostname: string; nombre: string; site_id: string | null; sitio: string | null; organizacion: string | null;
  local_id: string | null; so: string; so_version: string | null; so_build: string | null; arquitectura: string | null;
  version_agente: string | null; estado: string; visto_ultimo: string | null; conectado: boolean; ultimo_usuario: string | null;
  encendido_seg: number | null; reinicio_pendiente: boolean | null; ip_publica: string | null; ip_local: string | null;
  virtual: boolean | null; alta: string | null; cpu: string | null; nucleos: number | null; ram_mb: number | null;
  disco_gb: number | null; fabricante: string | null; modelo: string | null; serie: string | null;
  antivirus: string | null; av_tiempo_real: boolean | null; firewall: boolean | null; cifrado: string | null; amenazas: number | null;
  parches_pendientes: number; alertas_abiertas: number; discos: Disco[] | null; rustdesk_id: string | null;
  programa_tpv: string | null; tpv_version: string | null;
}
export interface EstadoLocal { local_id: string; equipos: number; conectados: number; alertas: number; visto_ultimo: string | null; estado: 'ok' | 'alerta' | 'parcial' | 'caido' }
export interface Alerta {
  id: string; device_id: string | null; hostname: string | null; local_id: string | null; sitio: string | null;
  estado: string; severidad: string; titulo: string; mensaje: string | null; disparada: string;
  acusada: string | null; acusada_por: string | null; resuelta: string | null; nota_resolucion: string | null;
}
export interface Site { site_id: string; sitio: string; organizacion: string | null; local_id: string | null; manual: boolean; local_nombre: string | null; equipos: number; conectados: number }
export interface Metrica { momento: string; cpu: number | null; ram: number | null; disco: number | null }
export interface Script { id: string; nombre: string; descripcion: string | null; categoria: string | null; sistemas: string[] | null; lenguaje: string; parametros: unknown }

export const ESTADOS_SEDE: Record<EstadoLocal['estado'], { texto: string; tono: string }> = {
  ok: { texto: 'Todo bien', tono: 'bien' },
  alerta: { texto: 'Con alertas', tono: 'mal' },
  parcial: { texto: 'Alguno sin conexión', tono: 'aviso' },
  caido: { texto: 'Sin conexión', tono: 'mal' },
};
export const SEVERIDAD: Record<string, { texto: string; tono: string }> = {
  critical: { texto: 'Crítica', tono: 'mal' }, high: { texto: 'Alta', tono: 'mal' },
  medium: { texto: 'Media', tono: 'aviso' }, low: { texto: 'Baja', tono: 'neutro' }, info: { texto: 'Info', tono: 'neutro' },
};
export const ESTADO_ALERTA: Record<string, string> = {
  active: 'Activa', acknowledged: 'Acusada', resolved: 'Resuelta', suppressed: 'Silenciada', dismissed: 'Descartada',
};

// Enlaces al panel de Breeze (lo que el usuario de servicio no puede hacer).
export const enBreeze = {
  equipo: (id: string) => `${BREEZE_URL}/devices/${id}`,
  alerta: (id: string) => `${BREEZE_URL}/alerts/${id}`,
  terminal: (id: string) => `${BREEZE_URL}/remote/terminal/${id}`,
  archivos: (id: string) => `${BREEZE_URL}/remote/files/${id}`,
  ejecucion: (id: string, ej: string) => `${BREEZE_URL}/devices/${id}#scripts/${ej}`,
};

const COLS_EQUIPO = '*';
export const listarEquipos = (filtro: Record<string, string> = {}) =>
  API.get<Equipo[]>('rmm_equipos', { select: COLS_EQUIPO, order: 'sitio.nullslast,hostname', ...filtro });
export const equipo = (id: string) => API.single<Equipo>('rmm_equipos', { select: COLS_EQUIPO, id: `eq.${id}` });
export const estadosLocales = () => API.get<EstadoLocal[]>('rmm_estado_local', { select: '*' });
export const listarAlertas = (filtro: Record<string, string> = {}) =>
  API.get<Alerta[]>('rmm_alertas', { select: '*', order: 'disparada.desc', limit: '200', ...filtro });
export const listarSites = () => API.get<Site[]>('rmm_sites', { select: '*', order: 'local_id.nullsfirst,sitio' });
export const metricas = (deviceId: string) =>
  API.get<Metrica[]>('rmm_metricas', { select: 'momento,cpu,ram,disco', device_id: `eq.${deviceId}`, order: 'momento' });
export const listarScripts = () => API.get<Script[]>('rmm_scripts', { select: 'id,nombre,descripcion,categoria,sistemas,lenguaje,parametros', order: 'nombre' });

export async function nombresLocales(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map();
  const { data } = await API.get<{ id: string; nombre: string }[]>('locales', { select: 'id,nombre', id: `in.(${unicos.join(',')})` });
  return new Map((data ?? []).map(l => [l.id, l.nombre]));
}

// Pone (o quita, con null) la sede de un Site a mano: ya no lo toca el emparejado automático.
export const emparejarSite = (siteId: string, localId: string | null) =>
  API.upsert('rmm_sitios', 'site_id', { site_id: siteId, local_id: localId, manual: true });

// ── breeze-api ──────────────────────────────────────────────────────────────
export interface EstadoBreeze { configurado: boolean; url: string; comandos: Record<string, string> }
let _estado: Promise<EstadoBreeze | null> | null = null;

export async function pedirABreeze<T = Record<string, unknown>>(cuerpo: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${FUNCIONES_URL}/breeze-api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token()}` },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(40000),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, error: r.error ?? `error ${res.status}` };
    return { data: r as T, error: null };
  } catch (e: any) {
    return { data: null, error: e?.name === 'TimeoutError' ? 'Breeze no contesta — inténtalo de nuevo' : String(e?.message ?? e) };
  }
}

// ¿Está puesto el usuario de servicio? Se pregunta una vez por sesión.
export function estadoBreeze(): Promise<EstadoBreeze | null> {
  _estado ??= pedirABreeze<EstadoBreeze>({ accion: 'estado' }).then(r => r.data);
  return _estado;
}
