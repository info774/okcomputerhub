// VeriFactu (paridad bloque 7, tanda 3: modules/verifactu.js de la app): el
// tablero de adaptación de los TPV al RD 1007/2023, una tarjeta por SEDE.
// #/verifactu (kanban por fase, carriles, buscador) y #/verifactu/<id> (ficha
// con la auditoría técnica y las casillas). ESPEJO de la app (área
// `verifactu`, decisión de Fran: listo para el cambio). Reglas en reglas.ts.
// Vista bajo demanda.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

async function contador(): Promise<Contador | null> {
  const [n, urgentes] = await Promise.all([
    API.contar('verifactu_sedes', { fase: 'neq.cierre' }),
    API.contar('verifactu_sedes', { fase: 'neq.cierre', carril: 'eq.urgente' }),
  ]);
  if (n == null) return null;
  return { valor: n, subtitulo: urgentes ? `sedes en marcha · ${urgentes} urgentes` : 'sedes en marcha', tono: urgentes ? 'aviso' : 'bien' };
}

export const moduloVerifactu: Modulo = {
  id: 'verifactu',
  titulo: 'VeriFactu',
  grupo: 'Operaciones',
  icono: '🧾',
  explicacion: 'La adaptación de los TPV a VeriFactu, sede a sede: seis fases (censo, auditoría, taller, despliegue, formación y cierre) y tres carriles por plazo (sociedades antes del 1/1/2027, autónomos antes del 1/7/2027, y los TPV complicados). Hasta el cambio se ve aquí y se mueve en la app.',
  async pintar(el, params) {
    const { pintarVerifactu } = await import('./vista');
    await pintarVerifactu(el, params);
  },
  contador,
};
