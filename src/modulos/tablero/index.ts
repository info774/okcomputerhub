// Tablero de notas (tablero.js de la app): notas sueltas del equipo, que ve
// todo el mundo y cada cual edita y borra las suyas. Se carga bajo demanda.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

async function contador(): Promise<Contador | null> {
  const desde = new Date(Date.now() - 7 * 86400000).toISOString();
  const [n, nuevas] = await Promise.all([API.contar('tablero_notas'), API.contar('tablero_notas', { created_at: `gte.${desde}` })]);
  if (n == null) return null;
  return { valor: n, subtitulo: nuevas ? `notas · ${nuevas} esta semana` : 'notas en el tablero', tono: 'neutro' };
}

export const moduloTablero: Modulo = {
  id: 'tablero',
  titulo: 'Tablero',
  grupo: 'Organizar',
  icono: '📌',
  explicacion: 'Notas sueltas del equipo: lo que hay que recordar y no es un trabajo ni una tarea. Las ve todo el mundo; cada cual cambia y borra las suyas. Se pueden dictar con «Nota de voz».',
  pintar: async el => (await import('./vista')).pintar(el),
  contador,
};
