// Presupuestos (los de «Presupuestos» de la app actual): #/presupuestos (cifras,
// reparto por estado y lista con filtros) y #/presupuestos/<id> (ficha con sus
// líneas y lo que salió de él). Es ESPEJO de la app (área `presupuestos`, dueño
// `app`) y, con el área cortada, se crean y editan aquí (con líneas del
// catálogo y plantillas), se imprimen, se duplican, se convierten en trabajo y
// se mandan a Zoho. Vista bajo demanda. Prefijos de ids: pp-, pf-, ppl-, ppd-, pat-.
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
  explicacion: 'Los presupuestos de la app: cuánto hay abierto, cuánto se acepta y lo que lleva días enviado sin respuesta; cada uno con sus líneas, su cliente, su sede y el trabajo que salió de él. Mientras se lleven en la app es su copia (se refresca cada 15 min); al hacer el cambio se crean aquí con líneas del catálogo y plantillas, se imprimen, se convierten en trabajo y se mandan a Zoho.',
  async pintar(el, params) {
    const { pintarPresupuestos } = await import('./vista');
    await pintarPresupuestos(el, params);
  },
  contador,
};
