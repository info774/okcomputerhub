// Calendario (fase Final): la semana de la agenda (bloques de trabajo, tarea o
// ticket por técnico) con los fichajes reales encima. Se carga bajo demanda.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

async function contador(): Promise<Contador | null> {
  const d = new Date().toLocaleDateString('sv-SE');
  const n = await API.contar('agenda', { and: `(inicio.lte.${new Date(`${d}T23:59:59`).toISOString()},fin.gte.${new Date(`${d}T00:00:00`).toISOString()})` });
  return n == null ? null : { valor: n, subtitulo: 'bloques hoy', tono: 'neutro' };
}

export const moduloCalendario: Modulo = {
  id: 'calendario',
  titulo: 'Calendario',
  grupo: 'Operaciones',
  icono: '📅',
  explicacion: 'La semana de cada técnico: los días de trabajo programados y, encima, lo que de verdad se fichó. Hasta el cambio se planifica en la app; después se arrastra aquí.',
  pintar: async el => (await import('./vista')).pintar(el),
  contador,
};
