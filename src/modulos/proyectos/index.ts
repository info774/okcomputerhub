// Proyectos: organizador del ciclo idea → definición → investigación →
// roadmap → desarrollo → cerrado. #/proyectos (kanban, lista, por persona) y
// #/proyectos/<numero>/<pestaña> (ficha).
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { pintarListaProyectos } from './lista';
import { pintarFicha } from './ficha';

async function contador(): Promise<Contador | null> {
  const hoy = new Date().toLocaleDateString('sv-SE');
  const [abiertos, desarrollo, vencidas] = await Promise.all([
    API.contar('proyectos', { estado: 'neq.cerrado' }),
    API.contar('proyectos', { estado: 'eq.desarrollo' }),
    API.contar('proyecto_tareas', { estado: 'neq.hecho', fecha_limite: `lt.${hoy}` }),
  ]);
  if (abiertos == null) return null;
  return {
    valor: abiertos,
    subtitulo: vencidas ? `${vencidas} tarea(s) vencida(s)` : `${desarrollo ?? 0} en desarrollo`,
    tono: vencidas ? 'aviso' : 'neutro',
  };
}

export const moduloProyectos: Modulo = {
  id: 'proyectos',
  titulo: 'Proyectos',
  grupo: 'Organizar',
  icono: '🧭',
  explicacion: 'Cada proyecto pasa por fases: idea, definición (objetivos), investigación (páginas con fuentes), roadmap (hitos y tareas), desarrollo y cierre. Pueden ser internos o de un cliente, y enlazar trabajos, tickets, presupuestos y gastos de la app actual para ver su coste.',
  async pintar(el, params) {
    const numero = Number(params[0]);
    if (params[0] && Number.isInteger(numero) && numero > 0) await pintarFicha(el, numero, params[1]);
    else await pintarListaProyectos(el);
  },
  contador,
};
