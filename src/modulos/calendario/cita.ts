// Un bloque de agenda a mano: una CITA suelta del calendario (sin trabajo,
// «eventos libres» de agenda.js de la app) o un DÍA de un trabajo (la sección
// «Días de trabajo» de su ficha). El mismo formulario para crear y editar:
// #/calendario/cita · #/calendario/cita/<id> · #/calendario/dia/<trabajo_id>.
// Escribe en hub.agenda solo con el área cortada; el primer bloque de un
// trabajo vuelve a su fecha por hub.agenda_espejo. Prefijo de ids: cc-.
import { API } from '../../core/api';
import { equipo } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';

let _ctx: { id: string | null; trabajoId: string | null; volver: string } | null = null;
const hhmm = (d: Date) => d.toTimeString().slice(0, 5);

export async function pintarCita(el: HTMLElement, params: string[]) {
  const [tipo, ref] = params;
  const [personas, escribe] = await Promise.all([equipo(), esDelHub('agenda')]);
  let b: any = null, trabajo: any = null;
  if (tipo === 'cita' && ref) b = (await API.single<any>('agenda', { select: '*', id: `eq.${ref}` })).data;
  if (tipo === 'dia') {
    if (ref?.startsWith('b:')) b = (await API.single<any>('agenda', { select: '*', id: `eq.${ref.slice(2)}` })).data;
    const tid = b?.trabajo_id ?? ref;
    trabajo = (await API.single<any>('trabajos', { select: 'id,numero,titulo,tecnicos,duracion_teorica', id: `eq.${tid}` })).data;
    if (!trabajo) { el.innerHTML = '<p class="aviso mal">No existe ese trabajo.</p>'; return; }
  }
  const volver = trabajo ? `#/trabajos/${trabajo.numero}` : '#/calendario';
  _ctx = { id: b?.id ?? null, trabajoId: trabajo?.id ?? null, volver };
  const ini = b ? new Date(b.inicio) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })();
  const fin = b ? new Date(b.fin) : new Date(ini.getTime() + (trabajo?.duracion_teorica || 60) * 60000);
  const tecnicos: string[] = b?.tecnicos ?? trabajo?.tecnicos ?? [];
  const titulo = trabajo ? `${b ? 'Día' : 'Nuevo día'} del trabajo #${trabajo.numero} ${trabajo.titulo ?? ''}` : b ? 'Cita' : 'Nueva cita';
  el.innerHTML = `<p><a href="${volver}">← Volver</a></p><h2>${esc(titulo)}</h2>${escribe ? '' : avisoSoloLectura('La agenda')}
    <form class="tarjeta" id="cc-form" data-on-submit="ccGuardar" data-prevent="1">
      ${trabajo ? '' : `<label>Qué <input id="cc-titulo" required maxlength="200" value="${esc(b?.titulo ?? '')}" placeholder="Ej: Reunión con proveedor"></label>`}
      <div class="in-campos">
        <label>Día <input id="cc-fecha" type="date" required value="${ini.toLocaleDateString('sv-SE')}"></label>
        <label>Desde <input id="cc-ini" type="time" value="${hhmm(ini)}"></label>
        <label>Hasta <input id="cc-fin" type="time" value="${hhmm(fin)}"></label>
        ${trabajo ? '' : `<label class="check"><input id="cc-todo" type="checkbox" ${b?.todo_el_dia ? 'checked' : ''}> Todo el día</label>`}
      </div>
      <fieldset class="tf-tecnicos"><legend>Quién</legend>${personas.map(p => `<label class="check"><input type="checkbox" value="${esc(p.nombre)}" ${tecnicos.includes(p.nombre) ? 'checked' : ''}> ${esc(p.nombre)}</label>`).join('')}</fieldset>
      <div class="acciones"><button class="btn" type="submit" ${escribe ? '' : 'disabled'}>${b ? 'Guardar' : 'Añadir'}</button>
        ${b && escribe ? '<button type="button" class="btn peligro" data-action="ccBorrar">Quitar</button>' : ''}<a class="btn secundario" href="${volver}">Cancelar</a></div>
    </form>`;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
registrarAcciones({
  async ccGuardar() {
    if (!_ctx) return;
    const fecha = val('cc-fecha');
    const todo = (document.getElementById('cc-todo') as HTMLInputElement | null)?.checked ?? false;
    const ini = new Date(`${fecha}T${todo ? '00:00' : val('cc-ini') || '09:00'}:00`);
    const fin = todo ? new Date(ini.getTime() + 86400000) : new Date(`${fecha}T${val('cc-fin') || '10:00'}:00`);
    if (!(fin > ini)) { toast('La hora de fin va después de la de inicio', 'error'); return; }
    const tecnicos = [...document.querySelectorAll<HTMLInputElement>('#cc-form .tf-tecnicos input:checked')].map(i => i.value);
    const cuerpo: Record<string, unknown> = { inicio: ini.toISOString(), fin: fin.toISOString(), tecnicos: tecnicos.length ? tecnicos : null, todo_el_dia: todo };
    if (!_ctx.trabajoId) cuerpo.titulo = val('cc-titulo');
    else cuerpo.trabajo_id = _ctx.trabajoId;
    const r = _ctx.id ? await API.patch('agenda', { id: `eq.${_ctx.id}` }, cuerpo) : await API.post('agenda', cuerpo);
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast(_ctx.id ? 'Guardado' : 'Añadido a la agenda');
    location.hash = _ctx.volver;
  },
  async ccBorrar() {
    if (!_ctx?.id || !confirm('¿Quitar este bloque de la agenda?')) return;
    const r = await API.delete('agenda', { id: `eq.${_ctx.id}` });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Quitado de la agenda');
    location.hash = _ctx.volver;
  },
});
