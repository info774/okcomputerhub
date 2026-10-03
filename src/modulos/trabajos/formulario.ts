// Alta y edición de un trabajo: el MISMO formulario (como el modal de la app,
// donde tener dos formularios hacía que un arreglo en uno faltara en el otro).
// Dos caras, Simple y Completa (ui/modo-form.js de la app): la simple deja
// cliente, título, tipo, técnicos, fecha y hora; el defecto lo pone el
// dispositivo (móvil → Simple) y lo elegido a mano se recuerda.
// Escribe en hub.trabajos solo con el área cortada (RLS + esDelHub); la fecha
// crea o mueve su bloque de agenda por el disparador hub.trabajo_espejo_agenda.
// Prefijo de ids: tf-.
import { API } from '../../core/api';
import { equipo } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { buscarClientes } from '../ventas/datos';

export const TIPOS = ['Instalación', 'Asistencia', 'Mantenimiento', 'Visita comercial'];
export const ESTADOS = ['Pendiente', 'En progreso', 'Completado', 'Para facturar', 'Facturado', 'No facturar', 'Cancelado'];
export const PRIORIDADES = ['Urgente', 'Alta', 'Media', 'Baja'];

type Modo = 'simple' | 'completa';
const CLAVE_MODO = 'hub_tf_modo';
const leer = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
// Mismo umbral que initLayout de la app: por debajo de 768 px, móvil.
const modoInicial = (): Modo => (leer(CLAVE_MODO) as Modo | null) ?? (window.matchMedia('(max-width: 767px)').matches ? 'simple' : 'completa');

let _editando: { id: string; numero: number; estado: string } | null = null;

// Hora local de Canarias → ISO con su desfase (la app hace lo mismo con _localTzOffset).
function horaIso(fecha: string, hora: string): string | null {
  if (!fecha || !hora) return null;
  const d = new Date(`${fecha}T${hora}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const horaDe = (iso: string | null) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '');

export async function pintarFormulario(el: HTMLElement, numero?: string) {
  const [personas, escribe] = await Promise.all([equipo(), esDelHub('trabajos')]);
  let t: any = null;
  if (numero) {
    const r = await API.single<any>('trabajos', { select: '*', numero: `eq.${Number(numero) || 0}` });
    t = r.data;
    if (!t) { el.innerHTML = '<p class="aviso mal">No existe ese trabajo.</p><p><a href="#/trabajos">← Trabajos</a></p>'; return; }
  }
  _editando = t ? { id: t.id, numero: t.numero, estado: t.estado } : null;
  const [cli, locs, cons, pres] = await Promise.all([
    t?.cliente_id ? API.single<any>('clientes', { select: 'id,nombre', id: `eq.${t.cliente_id}` }) : Promise.resolve({ data: null }),
    t?.cliente_id ? API.get<any[]>('locales', { select: 'id,nombre', cliente_id: `eq.${t.cliente_id}`, activo: 'eq.true', order: 'nombre' }) : Promise.resolve({ data: [] }),
    t?.cliente_id ? API.get<any[]>('contactos', { select: 'id,nombre', cliente_id: `eq.${t.cliente_id}`, activo: 'eq.true', order: 'favorito.desc,nombre' }) : Promise.resolve({ data: [] }),
    t?.cliente_id ? API.get<any[]>('presupuestos', { select: 'id,numero,titulo', cliente_id: `eq.${t.cliente_id}`, order: 'created_at.desc', limit: '30' }) : Promise.resolve({ data: [] }),
  ]);
  const modo = modoInicial();
  const opt = (v: string, txt: string, sel: boolean) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(txt)}</option>`;
  const atras = t ? `#/trabajos/${t.numero}` : '#/trabajos';
  el.innerHTML = `<p><a href="${atras}">← ${t ? `Trabajo #${t.numero}` : 'Trabajos'}</a></p>
    <h2>${t ? `Editar el trabajo #${t.numero}` : 'Nuevo trabajo'}</h2>
    ${escribe ? '' : avisoSoloLectura('Los trabajos')}
    <form class="tarjeta tf-form" id="tf-form" data-modo="${modo}" data-on-submit="tfGuardar" data-prevent="1">
      <div class="segmentado tf-modo" role="tablist" aria-label="Cuántos campos">
        <button type="button" role="tab" aria-selected="${modo === 'simple'}" class="${modo === 'simple' ? 'activo' : ''}" data-action="tfModo" data-p0="simple">⚡ Simple</button>
        <button type="button" role="tab" aria-selected="${modo === 'completa'}" class="${modo === 'completa' ? 'activo' : ''}" data-action="tfModo" data-p0="completa">📋 Completa</button>
      </div>
      <p class="nota tf-ayuda">${modo === 'simple' ? 'Lo justo para apuntarlo; el resto, desde la ficha o en «Completa».' : 'Todos los campos.'}</p>
      <div class="in-campos">
        <label>Cliente <input id="tf-cliente-q" autocomplete="off" placeholder="Buscar por nombre o NIF…" value="${esc(cli.data?.nombre ?? '')}" data-on-input="tfBuscarCliente:$value"></label>
        <label class="tf-completa">Sede <select id="tf-local"><option value="">— Sin sede —</option>${(locs.data ?? []).map(l => opt(l.id, l.nombre, l.id === t?.local_id)).join('')}</select></label>
        <label class="tf-completa">Contacto <select id="tf-contacto"><option value="">—</option>${(cons.data ?? []).map(k => opt(k.id, k.nombre, k.id === t?.contacto_id)).join('')}</select></label>
      </div>
      <input type="hidden" id="tf-cliente" value="${esc(t?.cliente_id ?? '')}"><ul id="tf-cliente-res" class="resultados"></ul>
      <label>Título <span class="nota">(obligatorio)</span> <input id="tf-titulo" required maxlength="200" value="${esc(t?.titulo ?? '')}" placeholder="Ej: Instalación cámaras, Revisión alarma…"></label>
      <label class="tf-completa">Descripción <textarea id="tf-descripcion" rows="4" placeholder="Detalles del trabajo…">${esc(t?.descripcion ?? '')}</textarea></label>
      <div class="in-campos">
        <label>Tipo <select id="tf-tipo">${TIPOS.map(x => opt(x, x, x === (t?.tipo ?? 'Asistencia'))).join('')}</select></label>
        <label class="tf-completa">Estado <select id="tf-estado">${ESTADOS.map(x => opt(x, x, x === (t?.estado ?? 'Pendiente'))).join('')}</select></label>
        <label class="tf-completa">Prioridad <select id="tf-prioridad"><option value="">Sin prioridad</option>${PRIORIDADES.map(x => opt(x, x, x === t?.prioridad)).join('')}</select></label>
        <label>Fecha <input id="tf-fecha" type="date" value="${esc(t?.fecha_programada ?? '')}"></label>
        <label>Hora <input id="tf-hora" type="time" value="${esc(horaDe(t?.hora_llegada))}"></label>
        <label class="tf-completa">Duración estimada (min) <input id="tf-duracion" type="number" min="15" max="600" step="15" value="${esc(t?.duracion_teorica ?? '')}"></label>
      </div>
      <fieldset class="tf-tecnicos"><legend>Técnicos asignados</legend>
        ${personas.map(p => `<label class="check"><input type="checkbox" value="${esc(p.nombre)}" ${(t?.tecnicos ?? []).includes(p.nombre) ? 'checked' : ''}> ${esc(p.nombre)}</label>`).join('')}</fieldset>
      <details class="tf-completa tf-mas" ${t && (t.ubicacion || t.presupuesto_id || t.materiales || t.observaciones) ? 'open' : ''}><summary>Ubicación, presupuesto y notas</summary>
        <label>Ubicación (si no es la de la sede) <input id="tf-ubicacion" value="${esc(t?.ubicacion ?? '')}" placeholder="Dirección del trabajo…"></label>
        <label>Presupuesto <select id="tf-presupuesto"><option value="">— Sin presupuesto —</option>${(pres.data ?? []).map(p => opt(p.id, `#${p.numero} ${p.titulo ?? ''}`, p.id === t?.presupuesto_id)).join('')}</select></label>
        <label>Materiales <textarea id="tf-materiales" rows="2">${esc(t?.materiales ?? '')}</textarea></label>
        <label>Observaciones <textarea id="tf-observaciones" rows="2">${esc(t?.observaciones ?? '')}</textarea></label>
      </details>
      <div class="acciones"><button class="btn" type="submit" ${escribe ? '' : 'disabled'}>${t ? 'Guardar cambios' : 'Crear trabajo'}</button>
        <a class="btn secundario" href="${atras}">Cancelar</a></div>
    </form>`;
}

// Que ningún trabajo hecho se quede sin facturar (saveTrabajo de la app): al
// completarlo se propone dejarlo «Para facturar».
export async function ofrecerFacturar(id: string): Promise<boolean> {
  if (!confirm('Trabajo completado. ¿Lo dejamos marcado como «Para facturar»? Así sale en la lista de pendientes de facturar y no se olvida.')) return false;
  const r = await API.rpc('trabajo_estado', { p_id: id, p_estado: 'Para facturar' });
  if (r.error) { toast(r.error.message, 'error'); return false; }
  toast('Marcado para facturar');
  return true;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
let _timerCli = 0;

registrarAcciones({
  tfModo(m: Modo) {
    guardar(CLAVE_MODO, m);
    const f = document.getElementById('tf-form');
    if (!f) return;
    f.dataset.modo = m;
    f.querySelectorAll('.tf-modo button').forEach(b => { const on = (b as HTMLElement).dataset.p0 === m; b.classList.toggle('activo', on); b.setAttribute('aria-selected', String(on)); });
    const ayuda = f.querySelector('.tf-ayuda');
    if (ayuda) ayuda.textContent = m === 'simple' ? 'Lo justo para apuntarlo; el resto, desde la ficha o en «Completa».' : 'Todos los campos.';
  },
  tfBuscarCliente(q: string) {
    clearTimeout(_timerCli);
    (document.getElementById('tf-cliente') as HTMLInputElement).value = '';
    _timerCli = window.setTimeout(async () => {
      const ul = document.getElementById('tf-cliente-res');
      if (!ul) return;
      const cs = await buscarClientes(q);
      ul.innerHTML = cs.map(c => `<li><button type="button" class="btn secundario" data-action="tfElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}
        <small class="nota">${esc(c.nif ?? '')}</small></button></li>`).join('');
    }, 250);
  },
  async tfElegirCliente(id: string, nombre: string) {
    (document.getElementById('tf-cliente') as HTMLInputElement).value = id;
    (document.getElementById('tf-cliente-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('tf-cliente-res'); if (ul) ul.innerHTML = '';
    const [ls, ks, ps] = await Promise.all([
      API.get<any[]>('locales', { select: 'id,nombre', cliente_id: `eq.${id}`, activo: 'eq.true', order: 'nombre' }),
      API.get<any[]>('contactos', { select: 'id,nombre', cliente_id: `eq.${id}`, activo: 'eq.true', order: 'favorito.desc,nombre' }),
      API.get<any[]>('presupuestos', { select: 'id,numero,titulo', cliente_id: `eq.${id}`, order: 'created_at.desc', limit: '30' }),
    ]);
    const pon = (sel: string, vacio: string, filas: any[], txt: (x: any) => string) => {
      const s = document.getElementById(sel);
      if (s) s.innerHTML = `<option value="">${vacio}</option>${filas.map(x => `<option value="${esc(x.id)}" ${filas.length === 1 && sel === 'tf-local' ? 'selected' : ''}>${esc(txt(x))}</option>`).join('')}`;
    };
    pon('tf-local', '— Sin sede —', ls.data ?? [], x => x.nombre);
    pon('tf-contacto', '—', ks.data ?? [], x => x.nombre);
    pon('tf-presupuesto', '— Sin presupuesto —', ps.data ?? [], x => `#${x.numero} ${x.titulo ?? ''}`);
  },
  async tfGuardar() {
    const titulo = val('tf-titulo');
    if (!titulo) { toast('El título es obligatorio', 'error'); return; }
    const completa = document.getElementById('tf-form')?.dataset.modo === 'completa';
    const fecha = val('tf-fecha'), hora = val('tf-hora');
    const tecnicos = [...document.querySelectorAll<HTMLInputElement>('.tf-tecnicos input:checked')].map(i => i.value);
    const cuerpo: Record<string, unknown> = {
      titulo, tipo: val('tf-tipo') || 'Asistencia', cliente_id: val('tf-cliente') || null,
      fecha_programada: fecha || null, hora_llegada: horaIso(fecha, hora), tecnicos: tecnicos.length ? tecnicos : null,
    };
    // En Simple, lo escondido no se toca (al editar se queda como estaba).
    if (completa || !_editando) {
      Object.assign(cuerpo, {
        local_id: val('tf-local') || null, contacto_id: val('tf-contacto') || null,
        descripcion: val('tf-descripcion') || null, prioridad: val('tf-prioridad') || null,
        duracion_teorica: Number(val('tf-duracion')) || null, ubicacion: val('tf-ubicacion') || null,
        presupuesto_id: val('tf-presupuesto') || null, materiales: val('tf-materiales') || null, observaciones: val('tf-observaciones') || null,
      });
    }
    const estado = completa ? val('tf-estado') || 'Pendiente' : (_editando?.estado ?? 'Pendiente');
    if (!_editando) {
      // Completado exige fichaje: un alta nunca nace completada.
      cuerpo.estado = estado === 'Completado' ? 'Pendiente' : estado;
      const r = await API.post<any[]>('trabajos', cuerpo);
      if (r.error || !r.data?.[0]) { toast(`No se pudo crear: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
      toast(`Trabajo #${r.data[0].numero} creado`);
      ir('trabajos', String(r.data[0].numero));
      return;
    }
    const r = await API.patch('trabajos', { id: `eq.${_editando.id}` }, cuerpo);
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    if (estado !== _editando.estado) {
      const e = await API.rpc('trabajo_estado', { p_id: _editando.id, p_estado: estado });
      if (e.error) { toast(`Guardado, pero el estado no: ${e.error.message}`, 'error'); ir('trabajos', String(_editando.numero)); return; }
      if (estado === 'Completado') await ofrecerFacturar(_editando.id);
    }
    toast('Trabajo guardado');
    ir('trabajos', String(_editando.numero));
  },
});
