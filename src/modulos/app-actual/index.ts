// Lo que el hub aún no tiene: enlaces a la app actual
// (okcomputertenerife.web.app). Son dos orígenes y dos sesiones mientras
// convivan, así que allí se entra otra vez.
//
// Si alguno lleva contador, que salga del ESPEJO del hub (tablas de hub
// copiadas por sync-app), no de la app: ni una consulta más a producción.
import type { Modulo } from '../../core/modulo';
import { APP_ACTUAL_URL } from '../../core/config';


const EXPLICA = 'Esta pantalla sigue en la app actual. El número sale de la copia del hub (se refresca cada 15 min); al pulsar se abre la app de siempre en otra pestaña.';

function enlace(id: string, titulo: string, icono: string, contador?: Modulo['contador']): Modulo {
  return { id, titulo, grupo: 'En la app actual', icono, explicacion: EXPLICA, enlaceExterno: APP_ACTUAL_URL, contador };
}

export const modulosAppActual: Modulo[] = [
  enlace('facturacion-app', 'Facturación y cobros (app)', '💶'),
  enlace('whatsapp', 'WhatsApp', '📱'),
  enlace('fichaje', 'Fichaje y horas', '⏱'),
];
