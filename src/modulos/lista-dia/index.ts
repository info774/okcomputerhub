// Lista del día (paridad bloque 1, tanda 3): el «qué toca hoy» de cada persona
// (lista-dia.js de la app) y, en su pestaña Planificar, el planificador de hoy
// y mañana (ui/plan-dia.js). Se carga bajo demanda.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { usuario } from '../../core/estado';

// «Mi lista de hoy: 3/8» (el chip del dashboard de la app).
async function contador(): Promise<Contador | null> {
  const yo = usuario()?.nombre ?? '';
  const { data, error } = await API.get<{ completado: boolean }[]>('lista_dia', { select: 'completado', fecha: `eq.${new Date().toLocaleDateString('sv-SE')}`, usuario: `eq.${yo}` });
  if (error || !data) return null;
  const hechos = data.filter(x => x.completado).length;
  return { valor: data.length ? `${hechos}/${data.length}` : 0, subtitulo: data.length ? 'hechos de tu lista de hoy' : 'nada en tu lista de hoy', tono: data.length && hechos === data.length ? 'bien' : data.length ? 'aviso' : 'neutro' };
}

export const moduloListaDia: Modulo = {
  id: 'lista-dia',
  titulo: 'Lista del día',
  grupo: 'Operaciones',
  icono: '📋',
  explicacion: 'Lo que le toca hoy a cada persona: trabajos, tareas, tickets y recados sueltos. Meter algo en la lista de alguien es asignárselo, y marcarlo lo da por hecho (un trabajo o una tarea, solo con el fichaje hecho). En «Planificar» se pasa a hoy, a mañana o a la semana que viene lo que se ha quedado atrás.',
  pintar: async (el, p) => (await import('./vista')).pintar(el, p),
  contador,
};
