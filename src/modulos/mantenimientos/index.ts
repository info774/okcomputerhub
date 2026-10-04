// Mantenimientos (la pantalla «Mantenimientos» de la app), con sus pestañas:
// Resumen, Locales (tabla maestra y ficha de cada sede), Checklist,
// Seguimiento comercial y Plantillas (planes, tareas, checklists de visita).
// Espejo de la app: la ficha va con el área `clientes` y el catálogo, el
// seguimiento y los checklists con la de `mantenimiento`; con el área cortada
// se escribe aquí. Reglas portadas de mant-estados.js en datos.ts. Prefijo: mt-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

const CON_PLAN = { plan: 'not.in.("Sin mantenimiento","")', activo: 'neq.false' };

async function contador(): Promise<Contador | null> {
  const [n, torcidas] = await Promise.all([
    API.contar('locales', CON_PLAN),
    API.contar('locales', { ...CON_PLAN, estado_pago: 'in.("Pendiente de pago","Último aviso","Ultimo aviso","No paga")' }),
  ]);
  if (n == null) return null;
  return { valor: n, subtitulo: torcidas ? `sedes · ${torcidas} con el cobro torcido` : 'sedes con mantenimiento', tono: torcidas ? 'aviso' : 'bien' };
}

export const moduloMantenimientos: Modulo = {
  id: 'mantenimientos',
  titulo: 'Mantenimientos',
  grupo: 'Clientes',
  icono: '🔁',
  explicacion: 'La cartera de mantenimiento, sede a sede: qué plan lleva, quién la cobra, si va al corriente y cuánto deja al mes (administración); su ficha (certificado, copia de seguridad, control horario, teléfonos y código), las tareas del plan, el seguimiento comercial y los planes. Mientras se lleve en la app es su copia; al hacer el cambio se edita aquí.',
  async pintar(el, params) {
    const { pintarMantenimientos } = await import('./vista');
    await pintarMantenimientos(el, params);
  },
  contador,
};
