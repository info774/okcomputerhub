// Usuarios (paridad bloque 6, la sección «Usuarios» de Configuración de la
// app): quién entra en el hub, con qué rol y su teléfono (el del WhatsApp del
// equipo). Solo admin. Mientras el área `usuarios` sea de la app se ve en solo
// lectura (las personas se dan de alta allí y llegan por el sync); con el
// corte, alta, rol, teléfono y activar/desactivar (nunca a uno mismo, como la
// app). No se borra a nadie: se desactiva. Quien no es admin ve el menú del
// técnico (modo empleado, core/empleado.ts). Prefijo de ids: us-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { MENU_EMPLEADO } from '../../core/empleado';
import { modulo, resolver } from '../../core/router';
import { esc, toast } from '../../ui/dom';

interface Usu { id: string; nombre: string; email: string; rol: string; activo: boolean; telefono: string | null }

const ROLES: Record<string, string> = { admin: 'Administrador', tecnico: 'Técnico' };
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

async function pintar(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [{ data, error }, escribe] = await Promise.all([
    API.get<Usu[]>('usuarios', { select: 'id,nombre,email,rol,activo,telefono', order: 'activo.desc,nombre' }),
    esDelHub('usuarios'),
  ]);
  if (error) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los usuarios: ${esc(error.message)}</p>`; return; }
  const yo = usuario()?.id;
  const dis = escribe ? '' : 'disabled';
  const menu = [...MENU_EMPLEADO].filter(id => id !== 'inicio').map(id => modulo(id)?.titulo ?? id).join(' · ');
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('El alta de personas')}
    <section class="tarjeta">
      <table class="tabla us-tabla"><thead><tr><th>Persona</th><th>Rol</th><th>Teléfono (WhatsApp)</th><th>Estado</th><th></th></tr></thead><tbody>
      ${(data ?? []).map(u => `<tr class="${u.activo ? '' : 'apagado'}">
        <td><b>${esc(u.nombre)}</b>${u.id === yo ? ' <span class="chip">tú</span>' : ''}<br><small class="nota">${esc(u.email)}</small></td>
        <td><select id="us-rol-${esc(u.id)}" aria-label="Rol de ${esc(u.nombre)}" ${dis} ${u.id === yo ? 'disabled' : ''}>${Object.entries(ROLES).map(([k, t]) => `<option value="${k}" ${k === u.rol ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><input id="us-tel-${esc(u.id)}" type="tel" value="${esc(u.telefono ?? '')}" placeholder="+34 6…" aria-label="Teléfono de ${esc(u.nombre)}" ${dis}></td>
        <td>${u.activo ? '<span class="chip bien">Activo</span>' : '<span class="chip">Desactivado</span>'}</td>
        <td class="acciones">${escribe ? `<button class="btn secundario" data-action="usGuardar" data-p0="${esc(u.id)}">Guardar</button>
          ${u.id === yo ? '' : `<button class="btn secundario" data-action="usActivo" data-p0="${esc(u.id)}" data-p1="${u.activo ? '0' : '1'}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="vacio">Sin usuarios.</td></tr>'}</tbody></table>
    </section>
    <form class="tarjeta" id="us-alta" data-on-submit="usCrear" data-prevent="1"><h2>Nuevo usuario</h2>
      <div class="in-campos">
        <label>Nombre <input id="us-nombre" required maxlength="80" placeholder="Francesco, Cristian…" ${dis}></label>
        <label>Correo de Google <input id="us-email" type="email" required ${dis}></label>
        <label>Rol <select id="us-rol" ${dis}><option value="tecnico">Técnico</option><option value="admin">Administrador</option></select></label>
        <label>Teléfono <input id="us-telefono" type="tel" placeholder="Opcional: su WhatsApp" ${dis}></label>
      </div>
      <div class="acciones"><button class="btn" type="submit" ${dis}>Dar de alta</button></div>
      <p class="nota">Entra con su cuenta de Google de ese correo. Un técnico ve el menú reducido: ${esc(menu)}.</p>
    </form>`;
}

const limpioTel = (t: string) => t.replace(/[^\d+ ]/g, '').trim() || null;

registrarAcciones({
  async usCrear() {
    const nombre = val('us-nombre'), email = val('us-email').toLowerCase();
    if (!nombre || !email) { toast('Nombre y correo son obligatorios', 'error'); return; }
    const r = await API.post('usuarios', { nombre, email, rol: val('us-rol') || 'tecnico', telefono: limpioTel(val('us-telefono')), activo: true });
    if (r.error) { toast(/unique|duplicate/i.test(r.error.message) ? 'Ese correo ya está dado de alta' : `No se pudo crear: ${r.error.message}`, 'error'); return; }
    toast(`${nombre} ya puede entrar`);
    resolver();
  },
  async usGuardar(id: string) {
    const cambios: Record<string, unknown> = { telefono: limpioTel(val(`us-tel-${id}`)) };
    if (id !== usuario()?.id) cambios.rol = val(`us-rol-${id}`);
    const r = await API.patch('usuarios', { id: `eq.${id}` }, cambios);
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    toast('Guardado');
    resolver();
  },
  async usActivo(id: string, activar: string) {
    if (id === usuario()?.id) { toast('No puedes desactivarte a ti mismo', 'error'); return; }
    const r = await API.patch('usuarios', { id: `eq.${id}` }, { activo: activar === '1' });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast(activar === '1' ? 'Activado' : 'Desactivado: ya no puede entrar');
    resolver();
  },
});

async function contador(): Promise<Contador | null> {
  const n = await API.contar('usuarios', { activo: 'eq.true' });
  return n == null ? null : { valor: n, subtitulo: n === 1 ? 'persona activa' : 'personas activas' };
}

export const moduloUsuarios: Modulo = {
  id: 'usuarios',
  titulo: 'Usuarios',
  grupo: 'Sistema',
  icono: '🔑',
  soloAdmin: true,
  explicacion: 'Quién entra en el hub, con qué rol y con qué teléfono (el de su WhatsApp, para las órdenes del equipo). Un técnico ve el menú reducido de la calle. No se borra a nadie: se desactiva. Mientras las personas se den de alta en la app, aquí se ven y llegan solas.',
  pintar,
  contador,
};
