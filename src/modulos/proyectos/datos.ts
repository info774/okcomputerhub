// Datos de proyectos (tablas propias del hub: aquí se escribe sin reservas de
// área). Lo del espejo (clientes, trabajos…) solo se LEE.
import { API } from '../../core/api';

export const FASES = [
  { id: 'idea', nombre: 'Idea', ayuda: 'Algo que merece la pena mirar. Una línea basta.' },
  { id: 'definicion', nombre: 'Definición', ayuda: 'Qué se quiere conseguir y cómo se sabrá: los objetivos.' },
  { id: 'investigacion', nombre: 'Investigación', ayuda: 'Buscar información, opciones y precios; queda en páginas con sus fuentes.' },
  { id: 'roadmap', nombre: 'Roadmap', ayuda: 'Hitos con fechas y las tareas de cada uno.' },
  { id: 'desarrollo', nombre: 'Desarrollo', ayuda: 'Se está haciendo: tareas en curso, horas y gastos.' },
  { id: 'cerrado', nombre: 'Cerrado', ayuda: 'Terminado (o descartado), con lo que salió.' },
] as const;
export type Fase = typeof FASES[number]['id'];
export const nombreFase = (id: string) => FASES.find(f => f.id === id)?.nombre ?? id;
export const siguienteFase = (id: string): Fase | null => {
  const i = FASES.findIndex(f => f.id === id);
  return i >= 0 && i < FASES.length - 1 ? FASES[i + 1].id : null;
};

export interface Proyecto {
  id: string; numero: number; created_at: string; updated_at: string;
  titulo: string; tipo: 'interno' | 'cliente'; estado: Fase; prioridad: string;
  cliente_id: string | null; local_id: string | null; responsable_id: string | null;
  descripcion: string | null; fecha_inicio: string | null; fecha_objetivo: string | null;
  presupuesto: number | null; presupuesto_id: string | null; orden: number;
  cerrado_at: string | null; resultado: string | null;
}
export interface Objetivo { id: string; proyecto_id: string; texto: string; metrica: string | null; hecho: boolean; orden: number }
export interface Hito {
  id: string; proyecto_id: string; nombre: string; descripcion: string | null;
  fecha_inicio: string | null; fecha_objetivo: string | null; estado: 'pendiente' | 'en_curso' | 'hecho'; orden: number;
}
export interface Pagina {
  id: string; proyecto_id: string; created_at: string; updated_at: string; tipo: string; titulo: string;
  contenido: string; fuentes: { titulo?: string; url: string }[]; autor: 'persona' | 'claude'; autor_id: string | null; orden: number;
}
export interface TareaP {
  id: string; proyecto_id: string; hito_id: string | null; titulo: string; descripcion: string | null;
  estado: 'pendiente' | 'en_curso' | 'hecho'; responsable_id: string | null; fecha_limite: string | null;
  horas_previstas: number | null; hecha_at: string | null; orden: number;
}
export interface Vinculo { id: string; proyecto_id: string; tabla: string; registro_id: string; nota: string | null }

export const CAMPOS_PROYECTO = 'id,numero,created_at,updated_at,titulo,tipo,estado,prioridad,cliente_id,local_id,responsable_id,descripcion,fecha_inicio,fecha_objetivo,presupuesto,presupuesto_id,orden,cerrado_at,resultado';

export async function listarProyectos(incluirCerrados: boolean) {
  const p: Record<string, string> = { select: CAMPOS_PROYECTO, order: 'orden.asc,numero.desc' };
  if (!incluirCerrados) p.estado = 'neq.cerrado';
  return API.fetchAll<Proyecto>('proyectos', p);
}

export async function proyectoPorNumero(numero: number) {
  return API.single<Proyecto>('proyectos', { select: CAMPOS_PROYECTO, numero: `eq.${numero}` });
}

export async function crearProyecto(datos: Partial<Proyecto>) {
  return API.post<Proyecto[]>('proyectos', datos);
}

export const actualizarProyecto = (id: string, cambios: Partial<Proyecto>) => API.patch('proyectos', { id: `eq.${id}` }, cambios);

// Piezas de un proyecto, de una vez.
export async function piezas(proyectoId: string) {
  const f = { proyecto_id: `eq.${proyectoId}` };
  const [objetivos, hitos, paginas, tareas, vinculos] = await Promise.all([
    API.get<Objetivo[]>('proyecto_objetivos', { ...f, select: '*', order: 'orden,created_at' }),
    API.get<Hito[]>('proyecto_hitos', { ...f, select: '*', order: 'orden,fecha_objetivo.nullslast,created_at' }),
    API.get<Pagina[]>('proyecto_paginas', { ...f, select: '*', order: 'orden,created_at' }),
    API.get<TareaP[]>('proyecto_tareas', { ...f, select: '*', order: 'orden,created_at' }),
    API.get<Vinculo[]>('proyecto_vinculos', { ...f, select: '*', order: 'created_at' }),
  ]);
  const error = objetivos.error ?? hitos.error ?? paginas.error ?? tareas.error ?? vinculos.error;
  return {
    error,
    objetivos: objetivos.data ?? [], hitos: hitos.data ?? [], paginas: paginas.data ?? [],
    tareas: tareas.data ?? [], vinculos: vinculos.data ?? [],
  };
}

// Tablas enlazables del espejo: cómo buscarlas y cómo nombrar una fila.
export const ENLAZABLES: Record<string, { nombre: string; select: string; buscar: (q: string) => Record<string, string>; rotulo: (f: any) => string }> = {
  trabajos: {
    nombre: 'Trabajo', select: 'id,numero,titulo,descripcion,estado,fecha_programada',
    buscar: (q): Record<string, string> => /^\d+$/.test(q) ? { numero: `eq.${q}` } : { or: `(titulo.ilike.*${q}*,descripcion.ilike.*${q}*)` },
    rotulo: f => `#${f.numero ?? '?'} ${f.titulo || (f.descripcion ?? '').slice(0, 60)} · ${f.estado ?? ''}`,
  },
  tickets: {
    nombre: 'Ticket', select: 'id,numero,titulo,estado',
    buscar: (q): Record<string, string> => /^\d+$/.test(q) ? { numero: `eq.${q}` } : { titulo: `ilike.*${q}*` },
    rotulo: f => `#${f.numero ?? '?'} ${f.titulo} · ${f.estado ?? ''}`,
  },
  tareas: {
    nombre: 'Tarea (app)', select: 'id,numero,titulo,estado',
    buscar: (q): Record<string, string> => /^\d+$/.test(q) ? { numero: `eq.${q}` } : { titulo: `ilike.*${q}*` },
    rotulo: f => `#${f.numero ?? '?'} ${f.titulo} · ${f.estado ?? ''}`,
  },
  presupuestos: {
    nombre: 'Presupuesto', select: 'id,numero_presupuesto,titulo,estado,total',
    buscar: q => ({ or: `(titulo.ilike.*${q}*,numero_presupuesto.ilike.*${q}*)` }),
    rotulo: f => `${f.numero_presupuesto ?? ''} ${f.titulo ?? ''} · ${f.estado ?? ''} · ${Number(f.total ?? 0).toFixed(2)} €`,
  },
  gastos: {
    nombre: 'Gasto', select: 'id,fecha,descripcion,categoria,importe',
    buscar: q => ({ or: `(descripcion.ilike.*${q}*,categoria.ilike.*${q}*)` }),
    rotulo: f => `${f.fecha ?? ''} ${f.descripcion || f.categoria || ''} · ${Number(f.importe ?? 0).toFixed(2)} €`,
  },
};

// Texto seguro para un filtro ilike de PostgREST (sin comodines ni separadores).
export const limpiarBusqueda = (q: string) => q.replace(/[*,()%\\]/g, ' ').trim().slice(0, 60);
