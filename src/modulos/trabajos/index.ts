// Trabajos (fase Final): la pantalla se carga bajo demanda (vista.ts).
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

async function contador(): Promise<Contador | null> {
  const n = await API.contar('trabajos', { estado: 'in.(Pendiente,"En progreso")' });
  return n == null ? null : { valor: n, subtitulo: 'pendientes o en curso', tono: 'neutro' };
}

export const moduloTrabajos: Modulo = {
  id: 'trabajos',
  titulo: 'Trabajos',
  grupo: 'Operaciones',
  icono: '🛠',
  explicacion: 'Los trabajos con todo lo suyo: cliente y sede, técnicos, días de agenda, fichajes, material, comentarios y fotos. Hasta el cambio se siguen llevando en la app: aquí se ven; después se cambian aquí.',
  pintar: async (el, p) => (await import('./vista')).pintar(el, p),
  contador,
};
