// Configuración (paridad bloque 6, modules/configuracion.js de la app). Solo
// admin, como la app. En la app vivía en el navegador (localStorage, distinto
// en cada equipo); aquí va a la base (hub.config), igual para todos:
//   · Empresa: los datos con los que salen parte, presupuesto y factura (la
//     MISMA fila `facturacion_emisor` que edita Facturación) y el IGIC.
//   · Tarifas del servicio técnico presencial: las de cada plan salen de su
//     plantilla de mantenimiento (coste_presencial_*, se cambian allí); aquí
//     solo la de «Sin mantenimiento» (`tarifa_sin_mantenimiento`).
//   · Avisos en este dispositivo e instalar la app (shell/avisos-dispositivo.ts).
//   · Sesión, accesos a Usuarios / Registro / Datos y la política de privacidad.
// No se portan (decisión del bloque 6): los colores de estado (los fija la
// marca del hub) ni la contraseña para borrar (los borrados son de admin y los
// guarda la RLS). Prefijo de ids: cfg-.
import type { Modulo } from '../../core/modulo';
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { esc, toast } from '../../ui/dom';
import { eur } from '../ventas/datos';
import { tarjetaAvisos, pintarAvisos } from '../../shell/avisos-dispositivo';

const CAMPOS: [string, string, string?][] = [['nombre', 'Razón social'], ['nif', 'CIF / NIF'], ['telefono', 'Teléfono', 'tel'], ['email', 'Correo', 'email'],
  ['direccion', 'Dirección'], ['cp', 'Código postal'], ['municipio', 'Municipio'], ['provincia', 'Provincia']];

const cfg = async <T = any>(clave: string) => (await API.single<{ valor: T }>('config', { select: 'valor', clave: `eq.${clave}` })).data?.valor ?? null;
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

async function pintar(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [emisor, igic, sin, planes] = await Promise.all([
    cfg<Record<string, string>>('facturacion_emisor'), cfg<number>('igic_pct'), cfg<{ estandar: number; urgente: number }>('tarifa_sin_mantenimiento'),
    API.get<any[]>('planes_mantenimiento', { select: 'nombre,coste_presencial_estandar,coste_presencial_urgente,activo', activo: 'eq.true', order: 'orden.nullslast,nombre' }),
  ]);
  const u = usuario();
  const e = emisor ?? {};
  el.innerHTML = `
    <form class="tarjeta" id="cfg-empresa" data-on-submit="cfgEmpresa" data-prevent="1"><h3>🏢 Empresa</h3>
      <p class="nota">Con estos datos salen el parte del trabajo, el presupuesto en PDF y las facturas del hub (la misma ficha que «Facturación → Emisor»).</p>
      <div class="in-campos">${CAMPOS.map(([k, t, tipo]) => `<label>${t} <input id="cfg-e-${k}" ${tipo ? `type="${tipo}"` : ''} value="${esc(e[k] ?? '')}"></label>`).join('')}
        <label>IGIC (%) <input id="cfg-igic" type="number" min="0" max="30" step="0.5" value="${esc(igic ?? 7)}"></label></div>
      <div class="acciones"><button class="btn" type="submit">Guardar</button></div>
    </form>
    <section class="tarjeta"><h3>💶 Tarifas del servicio técnico presencial</h3>
      <table class="tabla"><thead><tr><th>Plan</th><th class="num">Estándar</th><th class="num">Urgente</th></tr></thead><tbody>
        <tr><td>Sin mantenimiento</td>
          <td class="num"><input id="cfg-sin-std" type="number" min="0" step="0.01" value="${esc(sin?.estandar ?? '')}" aria-label="Sin mantenimiento, estándar"></td>
          <td class="num"><input id="cfg-sin-urg" type="number" min="0" step="0.01" value="${esc(sin?.urgente ?? '')}" aria-label="Sin mantenimiento, urgente"></td></tr>
        ${(planes.data ?? []).map(p => `<tr><td>${esc(p.nombre)}</td><td class="num">${p.coste_presencial_estandar != null ? eur(p.coste_presencial_estandar, 2) : '—'}</td>
          <td class="num">${p.coste_presencial_urgente != null ? eur(p.coste_presencial_urgente, 2) : '—'}</td></tr>`).join('')}</tbody></table>
      <div class="acciones"><button class="btn" data-action="cfgTarifas">Guardar la de «Sin mantenimiento»</button>
        <a class="btn secundario" href="#/mantenimientos/plantillas">Las de los planes, en sus plantillas</a></div>
    </section>
    ${tarjetaAvisos()}
    <section class="tarjeta"><h3>🔐 Sesión actual</h3>
      <p><b>${esc(u?.nombre ?? '')}</b> · ${esc(u?.email ?? '')} · ${u?.rol === 'admin' ? 'Administrador' : 'Técnico'}</p>
      <div class="acciones"><a class="btn secundario" href="#/usuarios">🔑 Usuarios</a><a class="btn secundario" href="#/registro">🕘 Registro de cambios</a>
        <a class="btn secundario" href="#/datos">🔄 Datos y sincronización</a><a class="btn secundario" href="/privacidad.html" target="_blank" rel="noopener">Política de privacidad ↗</a></div>
    </section>`;
  void pintarAvisos();
}

registrarAcciones({
  async cfgEmpresa() {
    const actual = (await cfg<Record<string, string>>('facturacion_emisor')) ?? {};
    const nuevo = { ...actual, ...Object.fromEntries(CAMPOS.map(([k]) => [k, val(`cfg-e-${k}`)])) };
    const igic = Number(val('cfg-igic'));
    if (!Number.isFinite(igic) || igic < 0 || igic > 30) { toast('El IGIC tiene que ser un porcentaje entre 0 y 30', 'error'); return; }
    const [a, b] = await Promise.all([
      API.upsert('config', 'clave', { clave: 'facturacion_emisor', valor: nuevo }),
      API.upsert('config', 'clave', { clave: 'igic_pct', valor: igic }),
    ]);
    const err = a.error ?? b.error;
    toast(err ? `No se pudo guardar: ${err.message}` : 'Datos de la empresa guardados', err ? 'error' : 'info');
  },
  async cfgTarifas() {
    const n = (id: string) => { const v = val(id); return v === '' ? null : Number(v); };
    const r = await API.upsert('config', 'clave', { clave: 'tarifa_sin_mantenimiento', valor: { estandar: n('cfg-sin-std'), urgente: n('cfg-sin-urg') } });
    toast(r.error ? `No se pudo guardar: ${r.error.message}` : 'Tarifa guardada', r.error ? 'error' : 'info');
  },
});

export const moduloConfiguracion: Modulo = {
  id: 'configuracion',
  titulo: 'Configuración',
  grupo: 'Sistema',
  icono: '⚙️',
  soloAdmin: true,
  explicacion: 'Los datos de la empresa (con los que salen partes, presupuestos y facturas), el IGIC y las tarifas del servicio presencial. Se guarda en el hub, igual para todos (en la app era de cada navegador).',
  pintar,
};
