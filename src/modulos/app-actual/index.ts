// Lo que el hub aún no tiene: enlaces a la app actual
// (okcomputertenerife.web.app). Son dos orígenes y dos sesiones mientras
// convivan, así que allí se entra otra vez.
//
// Los contadores salen del ESPEJO del hub (tablas de hub copiadas por
// sync-app), no de la app: así la baldosa no le suma ni una consulta a la
// base de producción.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { APP_ACTUAL_URL } from '../../core/config';


async function cuenta(tabla: string, filtro: Record<string, string>, sub: string, tonoSiHay: Contador['tono'] = 'neutro'): Promise<Contador | null> {
  const n = await API.contar(tabla, filtro);
  if (n == null) return null;
  return { valor: n, subtitulo: sub, tono: n > 0 ? tonoSiHay : 'bien' };
}

const EXPLICA = 'Esta pantalla sigue en la app actual. El número sale de la copia del hub (se refresca cada 15 min); al pulsar se abre la app de siempre en otra pestaña.';

function enlace(id: string, titulo: string, icono: string, contador?: Modulo['contador']): Modulo {
  return { id, titulo, grupo: 'En la app actual', icono, explicacion: EXPLICA, enlaceExterno: APP_ACTUAL_URL, contador };
}

export const modulosAppActual: Modulo[] = [
  enlace('tareas', 'Tareas', '✅', () => cuenta('tareas', { estado: 'in.(pendiente,en_progreso)' }, 'pendientes')),
  enlace('presupuestos', 'Presupuestos', '📄', () => cuenta('presupuestos', { estado: 'eq.Borrador' }, 'en borrador')),
  enlace('facturacion-app', 'Facturación y cobros (app)', '💶'),
  enlace('mantenimientos', 'Mantenimientos', '🔁'),
  enlace('inventario', 'Inventario', '📦'),
  enlace('whatsapp', 'WhatsApp', '📱'),
  enlace('fichaje', 'Fichaje y horas', '⏱'),
];
