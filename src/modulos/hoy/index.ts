// Hoy (fase Final): el modo calle del técnico. Se carga bajo demanda.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { usuario } from '../../core/estado';

async function contador(): Promise<Contador | null> {
  const d = new Date().toLocaleDateString('sv-SE');
  const yo = usuario()?.nombre ?? '';
  const n = await API.contar('agenda', { and: `(inicio.lte.${new Date(`${d}T23:59:59`).toISOString()},fin.gte.${new Date(`${d}T00:00:00`).toISOString()})`, tecnicos: `cs.{"${yo.replace(/"/g, '')}"}` });
  return n == null ? null : { valor: n, subtitulo: 'paradas tuyas hoy', tono: 'neutro' };
}

export const moduloHoy: Modulo = {
  id: 'hoy',
  titulo: 'Hoy (calle)',
  grupo: 'Operaciones',
  icono: '🚐',
  explicacion: 'Tu día en la calle: la siguiente parada con llamar y cómo llegar, lo que llevas fichado y terminar el trabajo con su foto. Hasta el cambio se ficha en la app; aquí se ve.',
  pintar: async el => (await import('./vista')).pintar(el),
  contador,
};
