// Alta y edición de un contacto (saveContacto de la app): #/contactos/nuevo,
// #/contactos/nuevo/c/<cliente>, #/contactos/nuevo/l/<sede> y
// #/contactos/<id>/editar, el MISMO formulario. Prefijo de ids: ctf-.
// - Los empleados solo los crea, cambia o da de baja un admin (regla de la app).
// - «Eliminar» de la app es una baja (activo = false); aquí se llama así.
// - Lo que la app hace además en Google Contactos y en favoritos por persona
//   (user_favoritos) no se porta aquí: es del bloque 7 (Google).
// Escribe en hub.contactos solo con el área `clientes` cortada (RLS + esDelHub).
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { buscarClientes } from '../ventas/datos';
import { olvidarContactos } from './vista';

export const TIPOS_CONTACTO: [string, string][] = [['otro', '👤 Otro'], ['empleado', '👷 Empleado'], ['proveedor', '🚚 Proveedor'], ['cliente', '🏢 Cliente']];

let _id: string | null = null;
let _tipoOriginal: string | null = null;
let _timerCli: number | undefined;

/** Las sedes activas de un cliente, como <option>. */
async function opcionesSedes(clienteId: string | null, elegida: string | null): Promise<string> {
  if (!clienteId) return '<option value="">— Sin sede —</option>';
  const { data } = await API.get<{ id: string; nombre: string }[]>('locales', { select: 'id,nombre', cliente_id: `eq.${clienteId}`, activo: 'neq.false', order: 'nombre' });
  return `<option value="">— Sin sede —</option>${(data ?? []).map(l => `<option value="${esc(l.id)}" ${l.id === elegida ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}`;
}

export async function pintarFormulario(el: HTMLElement, id?: string, desde?: { cliente?: string; sede?: string }) {
  const escribe = await esDelHub('contactos');
  let c: any = null;
  if (id) {
    c = (await API.single<any>('contactos', { select: '*', id: `eq.${id}` })).data;
    if (!c) { el.innerHTML = '<p class="aviso mal">No existe ese contacto.</p><p><a href="#/contactos">← Contactos</a></p>'; return; }
  }
  // Desde una sede: su cliente también.
  const sede = c?.local_id ?? desde?.sede ?? null;
  let clienteId = c?.cliente_id ?? desde?.cliente ?? null;
  if (sede && !clienteId) clienteId = (await API.single<{ cliente_id: string | null }>('locales', { select: 'cliente_id', id: `eq.${sede}` })).data?.cliente_id ?? null;
  const cli = clienteId ? (await API.single<{ id: string; nombre: string }>('clientes', { select: 'id,nombre', id: `eq.${clienteId}` })).data : null;
  _id = c?.id ?? null;
  _tipoOriginal = c?.tipo ?? null;
  const tipo = c?.tipo ?? 'otro';
  const bloqueado = !esAdmin() && tipo === 'empleado';
  const atras = c ? `#/contactos/${c.id}` : desde?.sede ? `#/sitios/${desde.sede}/contactos` : desde?.cliente ? `#/clientes/${desde.cliente}/contactos` : '#/contactos';
  const campo = (k: string, t: string, v: unknown, extra = '') => `<label>${t} <input id="ctf-${k}" value="${esc(v ?? '')}" ${extra}></label>`;
  el.innerHTML = `<p><a href="${atras}">← ${c ? esc(c.nombre) : 'Volver'}</a></p>
    <h2>${c ? 'Editar contacto' : 'Nuevo contacto'}</h2>
    ${escribe ? '' : avisoSoloLectura('Los contactos')}
    ${bloqueado ? '<p class="aviso">Los empleados solo los cambia un administrador.</p>' : ''}
    <form class="tarjeta" id="ctf-form" data-on-submit="ctfGuardar" data-prevent="1">
      <div class="segmentado" role="radiogroup" aria-label="Tipo">${TIPOS_CONTACTO
        .filter(([k]) => k !== 'empleado' || esAdmin() || tipo === 'empleado')
        .map(([k, n]) => `<label><input type="radio" name="ctf-tipo" value="${k}" ${k === tipo ? 'checked' : ''}> ${n}</label>`).join('')}</div>
      ${campo('nombre', 'Nombre <span class="nota">(obligatorio)</span>', c?.nombre, 'required maxlength="200" placeholder="Nombre y apellidos"')}
      <div class="in-campos">
        ${campo('empresa', 'Empresa', c?.empresa)}
        ${campo('cargo', 'Cargo', c?.cargo, 'placeholder="Encargado, administración…"')}
        ${campo('telefono', 'Teléfono', c?.telefono, 'type="tel"')}
        ${campo('telefono2', 'Otro teléfono', c?.telefono2, 'type="tel"')}
        ${campo('email', 'Correo', c?.email, 'type="email"')}
      </div>
      ${campo('direccion', 'Dirección', c?.direccion)}
      <label>Cliente <input id="ctf-cliente-q" autocomplete="off" placeholder="Buscar por nombre o NIF…" value="${esc(cli?.nombre ?? '')}" data-on-input="ctfBuscarCliente:$value"></label>
      <input type="hidden" id="ctf-cliente" value="${esc(cli?.id ?? '')}"><ul id="ctf-cliente-res" class="resultados"></ul>
      <label>Sede <select id="ctf-sede">${await opcionesSedes(cli?.id ?? null, sede)}</select></label>
      ${campo('etiquetas', 'Etiquetas <span class="nota">(separadas por comas)</span>', (c?.etiquetas ?? []).join(', '))}
      <label>Notas <textarea id="ctf-notas" rows="3">${esc(c?.notas ?? '')}</textarea></label>
      <label class="check"><input type="checkbox" id="ctf-favorito" ${c?.favorito ? 'checked' : ''}> ⭐ Favorito</label>
      <div class="acciones"><button class="btn" type="submit" ${escribe && !bloqueado ? '' : 'disabled'}>${c ? 'Guardar' : 'Crear contacto'}</button>
        <a class="btn secundario" href="${atras}">Cancelar</a></div>
    </form>`;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

registrarAcciones({
  ctfBuscarCliente(q: string) {
    clearTimeout(_timerCli);
    (document.getElementById('ctf-cliente') as HTMLInputElement).value = '';
    _timerCli = window.setTimeout(async () => {
      const ul = document.getElementById('ctf-cliente-res');
      if (!ul) return;
      const cs = await buscarClientes(q);
      ul.innerHTML = cs.map(c => `<li><button type="button" class="btn secundario" data-action="ctfElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}
        <small class="nota">${esc(c.nif ?? '')}</small></button></li>`).join('');
    }, 250);
  },
  async ctfElegirCliente(id: string, nombre: string) {
    (document.getElementById('ctf-cliente') as HTMLInputElement).value = id;
    (document.getElementById('ctf-cliente-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('ctf-cliente-res'); if (ul) ul.innerHTML = '';
    const sel = document.getElementById('ctf-sede');
    if (sel) sel.innerHTML = await opcionesSedes(id, null);
  },
  async ctfGuardar() {
    const nombre = val('ctf-nombre');
    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const tipo = (document.querySelector('input[name="ctf-tipo"]:checked') as HTMLInputElement | null)?.value ?? 'otro';
    if ((tipo === 'empleado' || _tipoOriginal === 'empleado') && !esAdmin()) { toast('Los empleados solo los cambia un administrador', 'error'); return; }
    const etiquetas = [...new Set(val('ctf-etiquetas').split(',').map(e => e.trim()).filter(Boolean))];
    const cuerpo: Record<string, unknown> = {
      nombre, tipo, empresa: val('ctf-empresa') || null, cargo: val('ctf-cargo') || null,
      telefono: val('ctf-telefono') || null, telefono2: val('ctf-telefono2') || null, email: val('ctf-email') || null,
      direccion: val('ctf-direccion') || null, notas: val('ctf-notas') || null,
      favorito: (document.getElementById('ctf-favorito') as HTMLInputElement).checked,
      etiquetas: etiquetas.length ? etiquetas : null,
      cliente_id: val('ctf-cliente') || null, local_id: val('ctf-sede') || null, activo: true,
    };
    if (_id) {
      const r = await API.patch('contactos', { id: `eq.${_id}` }, cuerpo);
      if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
      olvidarContactos();
      toast('Contacto guardado');
      ir('contactos', _id);
      return;
    }
    const r = await API.post<{ id: string }[]>('contactos', cuerpo);
    const nuevo = r.data?.[0];
    if (r.error || !nuevo) { toast(`No se pudo crear: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
    olvidarContactos();
    toast('Contacto creado');
    ir('contactos', nuevo.id);
  },
});
