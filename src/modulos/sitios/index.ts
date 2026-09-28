// Sitios (las sedes de los clientes, «Sitios» en la app actual): #/sitios
// (listado con buscador y filtros) y #/sitios/<id>/<pestaña> (ficha). Es
// ESPEJO de la app (área `clientes`, dueño `app`): aquí se ve todo junto y se
// edita allí. La vista se carga bajo demanda. Prefijo de ids: si-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

async function contador(): Promise<Contador | null> {
  const n = await API.contar('locales', { activo: 'eq.true' });
  if (n == null) return null;
  return { valor: n, subtitulo: 'sitios de alta', tono: 'neutro' };
}

export const moduloSitios: Modulo = {
  id: 'sitios',
  titulo: 'Sitios',
  grupo: 'Clientes',
  icono: '📍',
  explicacion: 'Las sedes de los clientes, como en «Sitios» de la app: dirección y mapa, mantenimiento, programa del TPV, alarma, contactos, trabajos, tickets y el estado de sus equipos. Es la copia de la app (se refresca cada 15 min): los datos se siguen cambiando allí.',
  async pintar(el, params) {
    const { pintarSitios } = await import('./vista');
    await pintarSitios(el, params);
  },
  contador,
};
