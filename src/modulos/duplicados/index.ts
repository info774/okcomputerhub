// Fichas duplicadas (idea de «merge contacts» de Atomic CRM, 2026-10-10):
// #/duplicados[/<tipo>] lista los grupos de clientes, contactos o sedes que
// parecen la misma ficha (hub.duplicados) y #/duplicados/<tipo>/<queda>/<sale>
// enseña qué pasaría y fusiona (hub.fusionar). #/duplicados/<tipo>/<id> busca
// con qué fusionar una ficha (el botón «Fusionar con…» de las fichas). Solo
// admin. Detectar vale ya; fusionar, cuando las áreas sean del hub (la base lo
// comprueba). La vista se carga bajo demanda. Prefijo de ids: du-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

async function contador(): Promise<Contador | null> {
  const { data, error } = await API.rpc<Record<string, number>>('duplicados_resumen');
  if (error || !data) return null;
  const n = (data.cliente ?? 0) + (data.contacto ?? 0) + (data.sede ?? 0);
  return { valor: n, subtitulo: n === 1 ? 'posible duplicado' : 'posibles duplicados', tono: data.cliente ? 'aviso' : 'neutro' };
}

export const moduloDuplicados: Modulo = {
  id: 'duplicados',
  titulo: 'Fichas duplicadas',
  grupo: 'Clientes',
  icono: '⧉',
  soloAdmin: true,
  explicacion: 'Clientes, contactos y sedes que parecen la misma ficha (mismo NIF, correo, teléfono, nombre o dirección). Al fusionar dos, todo lo que colgaba de una (trabajos, tickets, sedes, contactos…) pasa a la otra, sus huecos se rellenan y la que sobra se borra. Antes se ve exactamente qué va a pasar.',
  async pintar(el, params) {
    const { pintarDuplicados } = await import('./vista');
    await pintarDuplicados(el, params);
  },
  contador,
};
