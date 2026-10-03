// Alta y edición de una sede (createLocal / saveLocal de la app):
// #/sitios/nuevo[/<cliente>] y #/sitios/<id>/editar, el MISMO formulario.
// Prefijo de ids: sf-. Lo de mantenimiento (plan, cuota, cobro) NO va aquí: es
// del bloque 4 de paridad y se sigue cambiando en la app (Cobros).
// - Sin enlace de mapa, se pone el de la dirección (como la app).
// - Al crear, el teléfono (si se escribe) entra como «Principal» en
//   local_telefonos, igual que el alta de la app.
// Escribe en hub.locales solo con el área `clientes` cortada (RLS + esDelHub).
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { buscarClientes } from '../ventas/datos';
import { olvidarSitios } from './vista';

export const TIPOS_SITIO = ['Local', 'Vivienda'];
export const ESTADOS_SITIO: [string, string][] = [['activo', 'Activo'], ['pendiente', 'Pendiente'], ['cerrado', 'Cerrado']];

let _id: string | null = null;
let _timerCli: number | undefined;

export const mapaDeDireccion = (dir: string) => `https://maps.google.com/?q=${encodeURIComponent(dir)}`;

export async function pintarFormulario(el: HTMLElement, id?: string, clienteId?: string) {
  const escribe = await esDelHub('locales');
  let l: any = null;
  if (id) {
    l = (await API.single<any>('locales', { select: '*', id: `eq.${id}` })).data;
    if (!l) { el.innerHTML = '<p class="aviso mal">No existe ese sitio.</p><p><a href="#/sitios">← Sitios</a></p>'; return; }
  }
  _id = l?.id ?? null;
  const cid = l?.cliente_id ?? clienteId ?? null;
  const cli = cid ? (await API.single<{ id: string; nombre: string }>('clientes', { select: 'id,nombre', id: `eq.${cid}` })).data : null;
  const atras = l ? `#/sitios/${l.id}` : cli ? `#/clientes/${cli.id}/sedes` : '#/sitios';
  const opt = (v: string, t: string, sel: boolean) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  const campo = (id: string, t: string, v: unknown, extra = '') => `<label>${t} <input id="${id}" value="${esc(v ?? '')}" ${extra}></label>`;
  el.innerHTML = `<p><a href="${atras}">← ${l ? esc(l.nombre) : cli ? esc(cli.nombre) : 'Sitios'}</a></p>
    <h2>${l ? 'Editar sitio' : 'Nuevo sitio'}</h2>
    ${escribe ? '' : avisoSoloLectura('Los sitios')}
    <form class="tarjeta" id="sf-form" data-on-submit="sfGuardar" data-prevent="1">
      <label>Cliente <input id="sf-cliente-q" autocomplete="off" placeholder="Buscar por nombre o NIF…" value="${esc(cli?.nombre ?? '')}" data-on-input="sfBuscarCliente:$value"></label>
      <input type="hidden" id="sf-cliente" value="${esc(cli?.id ?? '')}"><ul id="sf-cliente-res" class="resultados"></ul>
      ${campo('sf-nombre', 'Nombre <span class="nota">(obligatorio)</span>', l?.nombre, 'required maxlength="200"')}
      <div class="in-campos">
        <label>Tipo <select id="sf-tipo">${TIPOS_SITIO.map(t => opt(t, t, t === (l?.tipo ?? 'Local'))).join('')}</select></label>
        <label>Estado <select id="sf-estado">${ESTADOS_SITIO.map(([v, t]) => opt(v, t, v === (l?.estado ?? 'activo'))).join('')}</select></label>
      </div>
      ${campo('sf-direccion', 'Dirección', l?.direccion)}
      ${campo('sf-maps', 'Enlace de Google Maps <span class="nota">(si se deja vacío, el de la dirección)</span>', l?.maps_url, 'type="url" placeholder="https://maps.google.com/…"')}
      <div class="in-campos">
        ${campo('sf-horario', 'Horario', l?.horario, 'placeholder="L-V 9:00-14:00"')}
        ${campo('sf-tpv', 'Programa del TPV', l?.programa_tpv)}
      </div>
      ${l ? '' : campo('sf-telefono', 'Teléfono <span class="nota">(entra como «Principal»)</span>', '', 'type="tel"')}
      <label class="check"><input type="checkbox" id="sf-software" ${l?.tiene_software === false ? '' : 'checked'}> Tiene software nuestro (TPV, programa…)</label>
      <label>Notas <textarea id="sf-notas" rows="2">${esc(l?.notas ?? '')}</textarea></label>
      <label>Notas técnicas <textarea id="sf-notas-tecnicas" rows="3">${esc(l?.notas_tecnicas ?? '')}</textarea></label>
      <details ${l?.alarma_empresa || l?.alarma_codigo ? 'open' : ''}><summary>🚨 Alarma</summary>
        <div class="in-campos">
          ${campo('sf-alarma-empresa', 'Empresa', l?.alarma_empresa)}
          ${campo('sf-alarma-telefono', 'Teléfono', l?.alarma_telefono, 'type="tel"')}
          ${campo('sf-alarma-contrato', 'Contrato', l?.alarma_contrato)}
          ${campo('sf-alarma-codigo', 'Código', l?.alarma_codigo, 'autocomplete="off"')}
        </div>
        <label>Notas de la alarma <textarea id="sf-alarma-notas" rows="2">${esc(l?.alarma_notas ?? '')}</textarea></label>
      </details>
      <p class="nota">El mantenimiento (plan, cuota y cobro) se sigue cambiando en la app, en Mantenimientos → Cobros.</p>
      <div class="acciones"><button class="btn" type="submit" ${escribe ? '' : 'disabled'}>${l ? 'Guardar' : 'Crear sitio'}</button>
        <a class="btn secundario" href="${atras}">Cancelar</a></div>
    </form>`;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

registrarAcciones({
  sfBuscarCliente(q: string) {
    clearTimeout(_timerCli);
    (document.getElementById('sf-cliente') as HTMLInputElement).value = '';
    _timerCli = window.setTimeout(async () => {
      const ul = document.getElementById('sf-cliente-res');
      if (!ul) return;
      const cs = await buscarClientes(q);
      ul.innerHTML = cs.map(c => `<li><button type="button" class="btn secundario" data-action="sfElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}
        <small class="nota">${esc(c.nif ?? '')}</small></button></li>`).join('');
    }, 250);
  },
  sfElegirCliente(id: string, nombre: string) {
    (document.getElementById('sf-cliente') as HTMLInputElement).value = id;
    (document.getElementById('sf-cliente-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('sf-cliente-res'); if (ul) ul.innerHTML = '';
  },
  async sfGuardar() {
    const nombre = val('sf-nombre');
    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const direccion = val('sf-direccion');
    const cuerpo: Record<string, unknown> = {
      cliente_id: val('sf-cliente') || null, nombre, tipo: val('sf-tipo') || 'Local', estado: val('sf-estado') || 'activo',
      direccion: direccion || null, maps_url: val('sf-maps') || (direccion ? mapaDeDireccion(direccion) : null),
      horario: val('sf-horario') || null, programa_tpv: val('sf-tpv') || null,
      tiene_software: (document.getElementById('sf-software') as HTMLInputElement).checked,
      notas: val('sf-notas') || null, notas_tecnicas: val('sf-notas-tecnicas') || null,
      alarma_empresa: val('sf-alarma-empresa') || null, alarma_telefono: val('sf-alarma-telefono') || null,
      alarma_contrato: val('sf-alarma-contrato') || null, alarma_codigo: val('sf-alarma-codigo') || null,
      alarma_notas: val('sf-alarma-notas') || null,
    };
    if (_id) {
      const r = await API.patch('locales', { id: `eq.${_id}` }, cuerpo);
      if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
      olvidarSitios();
      toast('Sitio guardado');
      ir('sitios', _id);
      return;
    }
    cuerpo.activo = true;
    const r = await API.post<{ id: string }[]>('locales', cuerpo);
    const nuevo = r.data?.[0];
    if (r.error || !nuevo) { toast(`No se pudo crear: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
    const tel = val('sf-telefono');
    if (tel) {
      const t = await API.post('local_telefonos', { local_id: nuevo.id, nombre: 'Principal', numero: tel, rol: 'otro' });
      if (t.error) toast(`Sitio creado, pero no se guardó el teléfono: ${t.error.message}`, 'error');
    }
    olvidarSitios();
    toast('Sitio creado');
    ir('sitios', nuevo.id);
  },
});
