// Desk (fase 6): lo común de la pantalla de tickets. Los tickets son ya del
// hub (área cortada); los que la app sigue creando sola (WhatsApp, voz, RMM)
// y sus comentarios llegan por sync-app. SLA: lo calcula la base en horario
// laboral (hub.sla_politicas, hub.horario_laboral, hub.festivos).
import { usuario } from '../../core/estado';
import type { IconoLinea } from '../../shell/linea';

export interface Ticket {
  id: string; numero: number; created_at: string; updated_at: string | null; cliente_id: string | null; local_id: string | null;
  contacto_id: string | null; trabajo_id: string | null; titulo: string; descripcion: string | null; estado: string; prioridad: string | null;
  tecnico_id: string | null; resolucion: string | null; resolucion_categoria: string | null; via_contacto: string | null; canal: string | null;
  email_hilo: string | null; email_de: string | null; sla_respuesta_at: string | null; sla_resolucion_at: string | null;
  primera_respuesta_at: string | null; cerrado_at: string | null; valoracion: number | null; valoracion_comentario: string | null;
  valoracion_at: string | null; valoracion_token: string; etiquetas: string[];
}
export interface Comentario {
  id: string; ticket_id: string; autor_id: string | null; autor_nombre: string | null; texto: string; created_at: string;
  tipo: 'nota' | 'respuesta' | 'cliente'; canal: string | null; email_id: string | null; enviado_at: string | null; envio_error: string | null;
}
export interface Plantilla { id: string; titulo: string; texto: string; cierre: boolean; orden: number; activa: boolean }

export const ESTADOS = ['Abierto', 'En curso', 'Pendiente', 'Cerrado'];
export const ABIERTOS = ['Abierto', 'En curso', 'Pendiente'];
export const PRIORIDADES = ['Urgente', 'Alta', 'Media', 'Baja'];
export const CATEGORIAS = ['Remoto', 'Presencial', 'Teléfono', 'Pasó a trabajo', 'Sin acción', 'Otro'];
export const CANALES: Record<string, string> = { email: 'Correo', whatsapp: 'WhatsApp', telefono: 'Teléfono', presencial: 'En persona',
  portal: 'Portal', rmm: 'Monitorización', hub: 'Hub', app: 'App' };
// Icono de línea de cada canal (donde se pinta HTML; en <option> y texto, el nombre solo).
export const ICONO_CANAL: Record<string, IconoLinea | undefined> = { email: 'correo', whatsapp: 'mensaje', telefono: 'telefono', presencial: 'andando',
  portal: 'web', rmm: 'monitor', hub: 'etiqueta', app: 'movil' };
export const TONO_PRIORIDAD: Record<string, string> = { urgente: 'mal', alta: 'aviso', media: 'neutro', baja: 'neutro' };
export const prioridadNorm = (p: string | null) => (p ?? 'Media').toLowerCase();

// Qué plazo del SLA manda ahora y cómo va.
export function sla(t: Ticket, ahora = Date.now()): { texto: string; tono: 'bien' | 'aviso' | 'mal' | 'neutro'; que: string } | null {
  if (t.estado === 'Cerrado') return null;
  const resp = !t.primera_respuesta_at && t.sla_respuesta_at ? new Date(t.sla_respuesta_at).getTime() : null;
  const reso = t.sla_resolucion_at ? new Date(t.sla_resolucion_at).getTime() : null;
  const limite = resp != null && (reso == null || resp <= reso) ? resp : reso;
  if (limite == null) return null;
  const que = limite === resp ? 'Respuesta' : 'Resolución';
  const min = Math.round((limite - ahora) / 60000);
  const dura = (m: number) => m < 60 ? `${m} min` : m < 60 * 48 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} días`;
  if (min < 0) return { que, tono: 'mal', texto: `${que}: vencido hace ${dura(-min)}` };
  return { que, tono: min < 60 ? 'aviso' : 'neutro', texto: `${que}: vence en ${dura(min)}` };
}
export const limiteSla = (t: Ticket) => {
  const r = !t.primera_respuesta_at && t.sla_respuesta_at ? t.sla_respuesta_at : null;
  return [r, t.sla_resolucion_at].filter(Boolean).sort()[0] ?? '9999';
};

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Los técnicos van por NOMBRE (como en la app): completo o de pila.
export function esMio(nombre: string | null): boolean {
  const n = norm(usuario()?.nombre), g = norm(nombre);
  return !!g && (g === n || g === n.split(/\s+/)[0]);
}

export const enlaceValoracion = (t: Ticket) => `${location.origin}/valorar.html?t=${t.valoracion_token}`;

// Rellena {{contacto}}, {{cliente}}, {{numero}}, {{tecnico}} y {{valoracion}}.
export function rellenar(texto: string, t: Ticket, datos: { contacto?: string | null; cliente?: string | null }): string {
  const pila = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? '';
  const v: Record<string, string> = {
    contacto: pila(datos.contacto) || pila(datos.cliente) || '', cliente: datos.cliente ?? '', numero: String(t.numero),
    tecnico: pila(t.tecnico_id) || pila(usuario()?.nombre), valoracion: enlaceValoracion(t),
  };
  return texto.replace(/\{\{(\w+)\}\}/g, (m, k) => v[k] ?? m).replace(/Hola ,/g, 'Hola,');
}
