// Mantenimientos (la cartera de «Mantenimientos → Locales» de la app):
// #/mantenimientos. Una fila por SEDE con plan: quién la cobra (Stripe, la
// Zoho Billing vieja o nadie todavía), estado de pago y, para admins, la cuota
// NETA. Es ESPEJO (área `clientes`, `locales` de la app): aquí se consulta;
// altas, cambios de plan, enlaces de pago y contratos siguen en la app.
// Reglas portadas de la app (`mant-estados.js`): ver vista.ts. Prefijo: mt-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

const CON_PLAN = { plan: 'not.in.("Sin mantenimiento","")', activo: 'neq.false' };

async function contador(): Promise<Contador | null> {
  const [n, torcidas] = await Promise.all([
    API.contar('locales', CON_PLAN),
    API.contar('locales', { ...CON_PLAN, estado_pago: 'in.("Pendiente de pago","Último aviso","No paga")' }),
  ]);
  if (n == null) return null;
  return { valor: n, subtitulo: torcidas ? `sedes · ${torcidas} con el cobro torcido` : 'sedes con mantenimiento', tono: torcidas ? 'aviso' : 'bien' };
}

export const moduloMantenimientos: Modulo = {
  id: 'mantenimientos',
  titulo: 'Mantenimientos',
  grupo: 'Clientes',
  icono: '🔁',
  explicacion: 'La cartera de mantenimiento, sede a sede: qué plan lleva, quién la cobra (Stripe o la Zoho vieja), si va al corriente y, para administración, cuánto deja al mes. Es la copia de la app (se refresca cada 15 min): las altas, los cambios de plan, los enlaces de pago y los contratos se hacen allí.',
  async pintar(el) {
    const { pintarMantenimientos } = await import('./vista');
    await pintarMantenimientos(el);
  },
  contador,
};
