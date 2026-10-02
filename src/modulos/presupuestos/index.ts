// Presupuestos (los de «Presupuestos» de la app actual): #/presupuestos (cifras,
// reparto por estado y lista con filtros) y #/presupuestos/<id> (ficha con sus
// líneas y lo que salió de él). Es ESPEJO de la app (área `presupuestos`, dueño
// `app`): aquí se consultan; se crean, se cambian y se mandan a Zoho allí.
// Vista bajo demanda. Prefijo de ids: pp-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

async function contador(): Promise<Contador | null> {
  const [abiertos, borradores] = await Promise.all([
    API.contar('presupuestos', { estado: 'in.(Borrador,Enviado)' }),
    API.contar('presupuestos', { estado: 'eq.Borrador' }),
  ]);
  if (abiertos == null) return null;
  return { valor: abiertos, subtitulo: borradores ? `abiertos · ${borradores} en borrador` : 'abiertos', tono: borradores ? 'aviso' : abiertos ? 'neutro' : 'bien' };
}

export const moduloPresupuestos: Modulo = {
  id: 'presupuestos',
  titulo: 'Presupuestos',
  grupo: 'Clientes',
  icono: '📄',
  explicacion: 'Los presupuestos de la app: cuánto hay abierto, cuánto se acepta y lo que lleva días enviado sin respuesta; cada uno con sus líneas, su cliente, su sede y el trabajo que salió de él. Es la copia de la app (se refresca cada 15 min): se crean, se cambian y se mandan a Zoho allí.',
  async pintar(el, params) {
    const { pintarPresupuestos } = await import('./vista');
    await pintarPresupuestos(el, params);
  },
  contador,
};
