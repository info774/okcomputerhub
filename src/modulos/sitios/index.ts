// Sitios (las sedes de los clientes, «Sitios» en la app actual): #/sitios
// (listado con buscador y filtros) y #/sitios/<id>/<pestaña> (ficha). Es
// ESPEJO de la app (área `clientes`, dueño `app`): aquí se ve todo junto y se
// edita allí hasta el corte; cortada el área, se crean y editan aquí
// (#/sitios/nuevo[/<cliente>], #/sitios/<id>/editar, prefijo sf-). La vista se
// carga bajo demanda. Prefijo de ids: si-.
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
  explicacion: 'Las sedes de los clientes, como en «Sitios» de la app: dirección y mapa, mantenimiento, programa del TPV, alarma, teléfonos con su rol, contactos, trabajos, tickets y el estado de sus equipos. Mientras los clientes se lleven en la app es su copia (se refresca cada 15 min) y se cambia allí; al hacer el cambio, las sedes y sus teléfonos se dan de alta, se editan y se dan de baja desde aquí.',
  async pintar(el, params) {
    const { pintarSitios } = await import('./vista');
    await pintarSitios(el, params);
  },
  contador,
};
