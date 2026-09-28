// Contactos (la agenda de «Contactos» de la app actual): #/contactos
// (listado con buscador, tipos, favoritos y etiquetas) y #/contactos/<id>/<pestaña>
// (ficha). Es ESPEJO de la app (área `clientes`, dueño `app`): aquí se consulta
// y se llama; se edita allí. La vista se carga bajo demanda. Prefijo de ids: co-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

async function contador(): Promise<Contador | null> {
  const n = await API.contar('contactos', { activo: 'neq.false' });
  if (n == null) return null;
  return { valor: n, subtitulo: 'contactos', tono: 'neutro' };
}

export const moduloContactos: Modulo = {
  id: 'contactos',
  titulo: 'Contactos',
  grupo: 'Clientes',
  icono: '📇',
  explicacion: 'La agenda de «Contactos» de la app: clientes, proveedores, empleados y otros, con favoritos y etiquetas; cada uno con su cliente, su sitio y los trabajos y tickets en los que figura. Es la copia de la app (se refresca cada 15 min): los datos se siguen cambiando allí.',
  async pintar(el, params) {
    const { pintarContactos } = await import('./vista');
    await pintarContactos(el, params);
  },
  contador,
};
