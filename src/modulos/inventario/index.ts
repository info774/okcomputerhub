// Inventario (el «Inventario» de la app): #/inventario (stock por ubicación
// —cada furgoneta, la tienda— o el total sumado), #/inventario/movimientos
// (el libro de entradas, salidas y trasvases) y #/inventario/<id> (ficha del
// producto en una ubicación, con sus movimientos y dónde más lo hay). ESPEJO
// de la app (área `inventario`): el stock se mueve allí, siempre con su apunte.
// No repite Almacén: «qué pedir», proveedores y pedidos viven en #/almacen.
// Vista bajo demanda. Prefijo de ids: in-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

async function contador(): Promise<Contador | null> {
  const [n, agotados] = await Promise.all([
    API.contar('furgoneta_inventario'),
    API.contar('furgoneta_inventario', { cantidad: 'lte.0' }),
  ]);
  if (n == null) return null;
  return { valor: n, subtitulo: agotados ? `productos · ${agotados} agotados` : 'productos en las ubicaciones', tono: agotados ? 'aviso' : 'bien' };
}

export const moduloInventario: Modulo = {
  id: 'inventario',
  titulo: 'Inventario',
  grupo: 'Operaciones',
  icono: '📦',
  explicacion: 'Qué hay en cada furgoneta y en la tienda, lo que está por debajo del mínimo y el libro de movimientos: cada entrada, salida o trasvase con quién lo hizo y de qué trabajo viene. Es la copia de la app (el stock cada 15 min, los movimientos cada noche): el stock se mueve allí. Lo que hay que pedir está en Almacén.',
  async pintar(el, params) {
    const { pintarInventario } = await import('./vista');
    await pintarInventario(el, params);
  },
  contador,
};
