// Monitorización (fase 2): consola RMM sobre Breeze. Se LEE de Breeze por las
// vistas hub.rmm_* y lo que se le pide (acusar, comandos, scripts) va por la
// función breeze-api. Rutas:
//   #/monitorizacion/<sedes|equipos|alertas|emparejado|acciones>
//   #/monitorizacion/sede/<local_id>
//   #/monitorizacion/equipo/<device_id>/<pestaña>
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { pintarMonitorizacion } from './lista';
import { pintarEquipo } from './equipo';

async function contador(): Promise<Contador | null> {
  const [equipos, conectados, alertas] = await Promise.all([
    API.contar('rmm_equipos'),
    API.contar('rmm_equipos', { conectado: 'eq.true' }),
    API.contar('rmm_alertas', { estado: 'eq.active' }),
  ]);
  if (equipos == null) return null;
  return {
    valor: `${conectados ?? '?'}/${equipos}`,
    subtitulo: alertas ? `${alertas} alerta(s) activa(s)` : 'equipos conectados',
    tono: alertas ? 'mal' : conectados === equipos ? 'bien' : 'aviso',
  };
}

export const moduloMonitorizacion: Modulo = {
  id: 'monitorizacion',
  titulo: 'Monitorización',
  grupo: 'Clientes',
  icono: '🖥',
  explicacion: 'Los equipos de los clientes con el agente de Breeze: si están conectados, su hardware, discos, antivirus, parches, software (con la versión del TPV) y alertas. Desde aquí se acusan alertas, se mandan comandos (reiniciar, apagar, refrescar inventario) y se lanzan scripts; resolver alertas y el control remoto se hacen en el panel de Breeze con tu usuario.',
  async pintar(el, params) {
    if (params[0] === 'equipo' && params[1]) await pintarEquipo(el, params[1], params[2]);
    else await pintarMonitorizacion(el, params);
  },
  contador,
};
