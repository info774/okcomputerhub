// Alta y edición de un cliente (createCliente / saveCliente de la app):
// #/clientes/nuevo y #/clientes/<id>/editar, el MISMO formulario. Prefijo de ids: cf-.
// - NIF: «Buscar» trae la razón social de la web (función `clientes`, acción
//   `nif`) y avisa si ese NIF ya lo tiene otro cliente; con NIF repetido NO se
//   crea (la regla de la app).
// - Al crear, el cliente se da de alta en Zoho Books (`zoho_alta`, como
//   pushClienteToZoho de la app); si Zoho falla, el cliente queda creado y se
//   avisa. Editar NO toca Zoho (tampoco lo hace la app).
// Escribe en hub.clientes solo con el área `clientes` cortada (RLS + esDelHub).
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';

export const ESTADOS_CLIENTE: [string, string][] = [['activo', 'Activo'], ['potencial', 'Potencial'], ['cerrado', 'Cerrado']];
export const PLANES = ['Sin mantenimiento', 'Basic', 'Premium', 'Silver', 'Gold'];

let _id: string | null = null;

const escLike = (v: string) => v.replace(/[\\%_*,()]/g, ' ').trim();

/** Otro cliente activo con ese NIF (findClienteByNif de la app). */
export async function clientePorNif(nif: string, salvo?: string | null): Promise<{ id: string; nombre: string } | null> {
  const v = escLike(nif);
  if (!v) return null;
  const { data } = await API.get<{ id: string; nombre: string }[]>('clientes', { select: 'id,nombre', nif: `ilike.${v}`, activo: 'eq.true', limit: '5' });
  return (data ?? []).find(c => c.id !== salvo) ?? null;
}

/**
 * Alta de un cliente con las reglas de la app: con NIF repetido NO se crea, y
 * el nuevo se da de alta en Zoho Books (si Zoho falla, queda creado y se avisa).
 * La usan este formulario y el cliente rápido del alta de trabajo.
 */
export async function crearCliente(cuerpo: Record<string, unknown>): Promise<{ id?: string; error?: string; duplicado?: { id: string; nombre: string }; zoho?: string }> {
  const nif = String(cuerpo.nif ?? '').trim();
  if (nif) {
    const dup = await clientePorNif(nif);
    if (dup) return { error: 'Ese NIF ya existe: no se crea otro', duplicado: dup };
  }
  const r = await API.post<{ id: string }[]>('clientes', { plan: 'Sin mantenimiento', estado: 'activo', tipo: 'empresa', ...cuerpo, activo: true });
  const nuevo = r.data?.[0];
  if (r.error || !nuevo) return { error: `No se pudo crear: ${r.error?.message ?? 'sin respuesta'}` };
  const z = await llamarFuncion<{ zoho_id: string; reutilizado?: boolean }>('clientes', { accion: 'zoho_alta', cliente_id: nuevo.id }, 40000);
  return { id: nuevo.id, zoho: z.error ? `no se dio de alta en Zoho: ${z.error}` : z.data?.reutilizado ? 'enlazado con su contacto de Zoho' : 'dado de alta en Zoho' };
}

export async function pintarFormulario(el: HTMLElement, id?: string) {
  const escribe = await esDelHub('clientes');
  let c: any = null;
  if (id) {
    c = (await API.single<any>('clientes', { select: '*', id: `eq.${id}` })).data;
    if (!c) { el.innerHTML = '<p class="aviso mal">No existe ese cliente.</p><p><a href="#/clientes">← Clientes</a></p>'; return; }
  }
  _id = c?.id ?? null;
  const atras = c ? `#/clientes/${c.id}` : '#/clientes';
  const opt = (v: string, t: string, sel: boolean) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  el.innerHTML = `<p><a href="${atras}">← ${c ? esc(c.nombre) : 'Clientes'}</a></p>
    <h2>${c ? 'Editar cliente' : 'Nuevo cliente'}</h2>
    ${escribe ? '' : avisoSoloLectura('Los clientes')}
    <form class="tarjeta" id="cf-form" data-on-submit="cfGuardar" data-prevent="1">
      <div class="segmentado" role="radiogroup" aria-label="Tipo">
        <label><input type="radio" name="cf-tipo" value="empresa" ${(c?.tipo ?? 'empresa') !== 'individuo' ? 'checked' : ''}> Empresa</label>
        <label><input type="radio" name="cf-tipo" value="individuo" ${c?.tipo === 'individuo' ? 'checked' : ''}> Particular</label></div>
      <label for="cf-nif">NIF / CIF</label>
      <div class="cf-nif"><input id="cf-nif" value="${esc(c?.nif ?? '')}" autocomplete="off" placeholder="B12345678">
        <button type="button" class="btn secundario" data-action="cfBuscarNif">${ico('buscar')} Buscar el nombre</button></div>
      <p class="nota" id="cf-nif-estado" aria-live="polite"></p>
      <label>Nombre <span class="nota">(obligatorio)</span> <input id="cf-nombre" required maxlength="200" value="${esc(c?.nombre ?? '')}"></label>
      <div class="in-campos">
        <label>Teléfono <input id="cf-telefono" type="tel" value="${esc(c?.telefono ?? '')}"></label>
        <label>Correo <input id="cf-email" type="email" value="${esc(c?.email ?? '')}"></label>
      </div>
      <label>Dirección <input id="cf-direccion" value="${esc(c?.direccion ?? '')}"></label>
      <div class="in-campos">
        <label>Estado <select id="cf-estado">${ESTADOS_CLIENTE.map(([v, t]) => opt(v, t, v === (c?.estado ?? 'activo'))).join('')}</select></label>
        ${c ? '' : `<label>Plan <select id="cf-plan">${PLANES.map(p => opt(p, p, p === 'Sin mantenimiento')).join('')}</select></label>`}
        ${c && esAdmin() ? `<label>Contacto en Zoho (id) <input id="cf-zoho" value="${esc(c.zoho_id ?? '')}" inputmode="numeric"></label>` : ''}
      </div>
      <label>Notas <textarea id="cf-notas" rows="3">${esc(c?.notas ?? '')}</textarea></label>
      ${c ? '' : '<p class="nota">Al crearlo se da de alta también en Zoho Books (si ya hay un contacto con ese NIF, se enlaza ese).</p>'}
      <div class="acciones"><button class="btn" type="submit" ${escribe ? '' : 'disabled'}>${c ? 'Guardar' : 'Crear cliente'}</button>
        <a class="btn secundario" href="${atras}">Cancelar</a></div>
    </form>`;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const estado = (html: string, mal = false) => { const e = document.getElementById('cf-nif-estado'); if (e) { e.innerHTML = html; e.classList.toggle('mal', mal); } };
const avisoDuplicado = (d: { id: string; nombre: string }) => `${ico('atencion')} Ese NIF ya lo tiene <a href="#/clientes/${esc(d.id)}">${esc(d.nombre)}</a>. No lo dupliques.`;

registrarAcciones({
  async cfBuscarNif() {
    const nif = val('cf-nif');
    if (!nif) { estado('Escribe primero el NIF.', true); return; }
    estado('Buscando…');
    const [dup, r] = await Promise.all([clientePorNif(nif, _id), llamarFuncion<{ nombre: string; fuente: string }>('clientes', { accion: 'nif', nif }, 25000)]);
    const partes: string[] = [];
    if (r.error) partes.push(`No se pudo buscar: ${esc(r.error)}`);
    else if (r.data?.nombre) {
      const n = document.getElementById('cf-nombre') as HTMLInputElement;
      if (!n.value.trim()) n.value = r.data.nombre;
      partes.push(`Encontrado: <b>${esc(r.data.nombre)}</b>${n.value.trim() !== r.data.nombre ? ' (no se ha cambiado el nombre que ya habías puesto)' : ''}`);
    } else partes.push('No se ha encontrado el nombre en la web: escríbelo a mano.');
    if (dup) partes.push(avisoDuplicado(dup));
    estado(partes.join('<br>'), !!dup);
  },
  async cfGuardar() {
    const nombre = val('cf-nombre');
    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const nif = val('cf-nif');
    if (nif) {
      const dup = await clientePorNif(nif, _id);
      if (dup) { estado(avisoDuplicado(dup), true); toast('Ese NIF ya existe: no se crea otro', 'error'); return; }
    }
    const cuerpo: Record<string, unknown> = {
      tipo: (document.querySelector('input[name="cf-tipo"]:checked') as HTMLInputElement | null)?.value ?? 'empresa',
      nombre, nif: nif || null, telefono: val('cf-telefono') || null, email: val('cf-email') || null,
      direccion: val('cf-direccion') || null, notas: val('cf-notas') || null, estado: val('cf-estado') || 'activo',
    };
    if (_id) {
      if (document.getElementById('cf-zoho')) cuerpo.zoho_id = val('cf-zoho') || null;
      const r = await API.patch('clientes', { id: `eq.${_id}` }, cuerpo);
      if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
      toast('Cliente guardado');
      ir('clientes', _id);
      return;
    }
    cuerpo.plan = val('cf-plan') || 'Sin mantenimiento';
    const r = await crearCliente(cuerpo);
    if (!r.id) { if (r.duplicado) estado(avisoDuplicado(r.duplicado), true); toast(r.error ?? 'No se pudo crear', 'error'); return; }
    toast(`Cliente creado (${r.zoho})`, r.zoho?.startsWith('no ') ? 'error' : 'info');
    ir('clientes', r.id);
  },
});
