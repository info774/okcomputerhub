// Tareas (las de «Tareas» de la app actual): #/tareas (lista o kanban, con
// los filtros de la app y por persona) y #/tareas/<id> (ficha). Es ESPEJO de la
// app (área `tareas`, dueño `app`): aquí se consultan y se cambian allí. No son
// las comandas (`hub.comanda_tareas`, del hub). Vista bajo demanda. Prefijo: ta-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

async function contador(): Promise<Contador | null> {
  const hoy = new Date().toLocaleDateString('sv-SE');
  const [n, vencidas] = await Promise.all([
    API.contar('tareas', { estado: 'in.(pendiente,en_progreso)' }),
    API.contar('tareas', { estado: 'in.(pendiente,en_progreso)', fecha_vencimiento: `lt.${hoy}` }),
  ]);
  if (n == null) return null;
  return { valor: n, subtitulo: vencidas ? `pendientes · ${vencidas} vencidas` : 'pendientes', tono: vencidas ? 'aviso' : n ? 'neutro' : 'bien' };
}

export const moduloTareas: Modulo = {
  id: 'tareas',
  titulo: 'Tareas',
  grupo: 'Organizar',
  icono: '✅',
  explicacion: 'Las tareas de la app: pendientes, de hoy, vencidas o de alta prioridad, por persona, en lista o en tablero; cada una con su cliente, sitio, contacto y el trabajo, ticket u oportunidad del que cuelga. Es la copia de la app (se refresca cada 15 min): se crean y se cambian allí.',
  async pintar(el, params) {
    const { pintarTareas } = await import('./vista');
    await pintarTareas(el, params);
  },
  contador,
};
