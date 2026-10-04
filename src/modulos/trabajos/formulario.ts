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
import type { Plantilla } from './plantillas';
import { buscadorMaps, alElegirLugar } from '../../ui/maps';
import { tomarBorrador } from '../../ui/borrador';

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
let _plantillas: Plantilla[] = [];

// Hora local de Canarias → ISO con su desfase (la app hace lo mismo con _localTzOffset).
function horaIso(fecha: string, hora: string): string | null {
  if (!fecha || !hora) return null;
  const d = new Date(`${fecha}T${hora}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const horaDe = (iso: string | null) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '');

// `desdeOportunidad`: alta que nace de una oportunidad ganada (#/trabajos/nuevo/o/<id>):
// trae cliente, sede, contacto, título y descripción, y el trabajo queda enlazado a ella.
export async function pintarFormulario(el: HTMLElement, numero?: string, desdeOportunidad?: string) {
  const [personas, escribe, escribeCli] = await Promise.all([equipo(), esDelHub('trabajos'), esDelHub('clientes', 'locales')]);
  let t: any = null;
  if (numero) {
    const r = await API.single<any>('trabajos', { select: '*', numero: `eq.${Number(numero) || 0}` });
    t = r.data;
    if (!t) { el.innerHTML = '<p class="aviso mal">No existe ese trabajo.</p><p><a href="#/trabajos">← Trabajos</a></p>'; return; }
  }
  _editando = t ? { id: t.id, numero: t.numero, estado: t.estado } : null;
  let op: any = null;
  if (!t && desdeOportunidad) {
    op = (await API.single<any>('oportunidades', { select: 'id,titulo,descripcion,cliente_id,local_id,contacto_id', id: `eq.${desdeOportunidad}` })).data;
  }
  // Desde WhatsApp (ventana fija o «Desde WhatsApp»): el aviso ya resumido.
  const b = !t && !op ? tomarBorrador('trabajo') : null;
  // Valores de partida: los del trabajo que se edita, los de la oportunidad o los del borrador.
  const v: any = t ?? (op ? { cliente_id: op.cliente_id, local_id: op.local_id, contacto_id: op.contacto_id, titulo: op.titulo, descripcion: op.descripcion }
    : b ? { cliente_id: b.cliente_id, local_id: b.local_id, contacto_id: b.contacto_id, titulo: b.titulo, descripcion: b.descripcion,
      prioridad: b.prioridad, tipo: b.tipo ?? 'Asistencia', fecha_programada: b.fecha || null, hora_llegada: horaIso(b.fecha ?? '', b.hora ?? '') } : null);
  const [cli, locs, cons, pres] = await Promise.all([
    v?.cliente_id ? API.single<any>('clientes', { select: 'id,nombre', id: `eq.${v.cliente_id}` }) : Promise.resolve({ data: null }),
    v?.cliente_id ? API.get<any[]>('locales', { select: 'id,nombre', cliente_id: `eq.${v.cliente_id}`, activo: 'eq.true', order: 'nombre' }) : Promise.resolve({ data: [] }),
    v?.cliente_id ? API.get<any[]>('contactos', { select: 'id,nombre', cliente_id: `eq.${v.cliente_id}`, activo: 'eq.true', order: 'favorito.desc,nombre' }) : Promise.resolve({ data: [] }),
    v?.cliente_id ? API.get<any[]>('presupuestos', { select: 'id,numero,titulo', cliente_id: `eq.${v.cliente_id}`, order: 'created_at.desc', limit: '30' }) : Promise.resolve({ data: [] }),
  ]);
  const plantillas = t ? [] : await (await import('./plantillas')).plantillasActivas();
  _plantillas = plantillas;
  const modo = modoInicial();
  const opt = (v: string, txt: string, sel: boolean) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(txt)}</option>`;
  const atras = t ? `#/trabajos/${t.numero}` : op ? `#/oportunidades/${op.id}` : '#/trabajos';
  el.innerHTML = `<p><a href="${atras}">← ${t ? `Trabajo #${t.numero}` : op ? 'Oportunidad' : 'Trabajos'}</a></p>
    <h2>${t ? `Editar el trabajo #${t.numero}` : op ? `Nuevo trabajo de la oportunidad «${esc(op.titulo)}»` : 'Nuevo trabajo'}</h2>
    ${escribe ? '' : avisoSoloLectura('Los trabajos')}
    <form class="tarjeta tf-form" id="tf-form" data-modo="${modo}" data-on-submit="tfGuardar" data-prevent="1">
      <div class="segmentado tf-modo" role="tablist" aria-label="Cuántos campos">
        <button type="button" role="tab" aria-selected="${modo === 'simple'}" class="${modo === 'simple' ? 'activo' : ''}" data-action="tfModo" data-p0="simple">⚡ Simple</button>
        <button type="button" role="tab" aria-selected="${modo === 'completa'}" class="${modo === 'completa' ? 'activo' : ''}" data-action="tfModo" data-p0="completa">📋 Completa</button>
      </div>
      <p class="nota tf-ayuda">${modo === 'simple' ? 'Lo justo para apuntarlo; el resto, desde la ficha o en «Completa».' : 'Todos los campos.'}</p>
      ${plantillas.length ? `<label class="tf-plantilla">Partir de una plantilla <select id="tf-plantilla" data-on-change="tfPlantilla:$value"><option value="">— Ninguna —</option>${plantillas.map(p => opt(p.id, p.nombre, false)).join('')}</select>
        <a class="nota" href="#/trabajos/plantillas">Gestionar plantillas</a></label>` : ''}
      <div class="in-campos">
        <label>Cliente <input id="tf-cliente-q" autocomplete="off" placeholder="Buscar por nombre o NIF…" value="${esc(cli.data?.nombre ?? '')}" data-on-input="tfBuscarCliente:$value"></label>
        <label class="tf-completa">Sede <select id="tf-local"><option value="">— Sin sede —</option>${(locs.data ?? []).map(l => opt(l.id, l.nombre, l.id === v?.local_id)).join('')}</select></label>
        <label class="tf-completa">Contacto <select id="tf-contacto"><option value="">—</option>${(cons.data ?? []).map(k => opt(k.id, k.nombre, k.id === v?.contacto_id)).join('')}</select></label>
      </div>
      <input type="hidden" id="tf-cliente" value="${esc(v?.cliente_id ?? '')}"><input type="hidden" id="tf-oportunidad" value="${esc(op?.id ?? '')}"><ul id="tf-cliente-res" class="resultados"></ul>
      ${escribeCli ? `<div class="acciones tf-rapido">
        <button type="button" class="btn secundario" data-action="tfRapido" data-p0="nc" aria-expanded="false">+ Nuevo cliente</button>
        <button type="button" class="btn secundario" data-action="tfRapido" data-p0="nl" aria-expanded="false">+ Nueva sede</button></div>
      <fieldset id="tf-nc" class="tf-rapida" hidden><legend>Cliente nuevo</legend>
        <div class="cf-nif"><input id="tf-nc-nif" autocomplete="off" placeholder="NIF / CIF" aria-label="NIF / CIF">
          <button type="button" class="btn secundario" data-action="tfNcNif">🔎 Buscar el nombre</button></div>
        <p class="nota" id="tf-nc-estado" aria-live="polite"></p>
        <div class="in-campos"><label>Nombre <input id="tf-nc-nombre" maxlength="200"></label>
          <label>Teléfono <input id="tf-nc-telefono" type="tel"></label><label>Correo <input id="tf-nc-email" type="email"></label></div>
        <p class="nota">Se da de alta también en Zoho Books, como desde Clientes.</p>
        <div class="acciones"><button type="button" class="btn" data-action="tfNcCrear">Crear cliente y elegirlo</button></div></fieldset>
      <fieldset id="tf-nl" class="tf-rapida" hidden><legend>Sede nueva <span class="nota">(del cliente elegido, si lo hay)</span></legend>
        ${buscadorMaps('tf-nl')}
        <div class="in-campos"><label>Nombre <input id="tf-nl-nombre" maxlength="200"></label><label>Dirección <input id="tf-nl-direccion"></label></div>
        <input type="hidden" id="tf-nl-maps">
        <div class="acciones"><button type="button" class="btn" data-action="tfNlCrear">Crear sede y elegirla</button></div></fieldset>` : ''}
      <label>Título <span class="nota">(obligatorio)</span> <input id="tf-titulo" required maxlength="200" value="${esc(v?.titulo ?? '')}" placeholder="Ej: Instalación cámaras, Revisión alarma…"></label>
      <label class="tf-completa">Descripción <textarea id="tf-descripcion" rows="4" placeholder="Detalles del trabajo…">${esc(v?.descripcion ?? '')}</textarea></label>
      <div class="in-campos">
        <label>Tipo <select id="tf-tipo">${TIPOS.map(x => opt(x, x, x === (v?.tipo ?? 'Asistencia'))).join('')}</select></label>
        <label class="tf-completa">Estado <select id="tf-estado">${ESTADOS.map(x => opt(x, x, x === (v?.estado ?? 'Pendiente'))).join('')}</select></label>
        <label class="tf-completa">Prioridad <select id="tf-prioridad"><option value="">Sin prioridad</option>${PRIORIDADES.map(x => opt(x, x, x === v?.prioridad)).join('')}</select></label>
        <label>Fecha <input id="tf-fecha" type="date" value="${esc(v?.fecha_programada ?? '')}"></label>
        <label>Hora <input id="tf-hora" type="time" value="${esc(horaDe(v?.hora_llegada))}"></label>
        <label class="tf-completa">Duración estimada (min) <input id="tf-duracion" type="number" min="15" max="600" step="15" value="${esc(v?.duracion_teorica ?? '')}"></label>
      </div>
      <fieldset class="tf-tecnicos"><legend>Técnicos asignados</legend>
        ${personas.map(p => `<label class="check"><input type="checkbox" value="${esc(p.nombre)}" ${(v?.tecnicos ?? []).includes(p.nombre) ? 'checked' : ''}> ${esc(p.nombre)}</label>`).join('')}</fieldset>
      <details class="tf-completa tf-mas" ${t && (t.ubicacion || t.presupuesto_id || t.materiales || t.observaciones) ? 'open' : ''}><summary>Ubicación, presupuesto y notas</summary>
        <label>Ubicación (si no es la de la sede) <input id="tf-ubicacion" value="${esc(v?.ubicacion ?? '')}" placeholder="Dirección del trabajo…"></label>
        <label>Presupuesto <select id="tf-presupuesto"><option value="">— Sin presupuesto —</option>${(pres.data ?? []).map(p => opt(p.id, `#${p.numero} ${p.titulo ?? ''}`, p.id === v?.presupuesto_id)).join('')}</select></label>
        <label>Materiales <textarea id="tf-materiales" rows="2">${esc(v?.materiales ?? '')}</textarea></label>
        <label>Observaciones <textarea id="tf-observaciones" rows="2">${esc(v?.observaciones ?? '')}</textarea></label>
      </details>
      ${t ? '' : `<label class="check"><input type="checkbox" id="tf-lista"> Añadir a la lista del día de los técnicos</label>`}
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

// Lo traído de Google Maps a la sede rápida.
alElegirLugar('tf-nl', l => {
  const pon = (k: string, v: string) => { const e = document.getElementById(`tf-nl-${k}`) as HTMLInputElement | null; if (e && v) e.value = v; };
  pon('nombre', l.nombre); pon('direccion', l.direccion); pon('maps', l.mapsUrl);
});

const acciones = {
  // Cliente y sede «al vuelo» (openNuevoClienteDesde / toggleNuevoLocalInline de
  // la app): se crean sin salir del trabajo y quedan elegidos.
  tfRapido(cual: 'nc' | 'nl') {
    const caja = document.getElementById(`tf-${cual}`);
    if (!caja) return;
    caja.hidden = !caja.hidden;
    document.querySelector(`[data-action="tfRapido"][data-p0="${cual}"]`)?.setAttribute('aria-expanded', String(!caja.hidden));
    if (!caja.hidden) (document.getElementById(`tf-${cual}-${cual === 'nc' ? 'nif' : 'nombre'}`) as HTMLInputElement | null)?.focus();
  },
  async tfNcNif() {
    const nif = val('tf-nc-nif');
    const est = document.getElementById('tf-nc-estado');
    if (!nif) { if (est) est.textContent = 'Escribe primero el NIF.'; return; }
    if (est) est.textContent = 'Buscando…';
    const [{ clientePorNif }, { llamarFuncion }] = await Promise.all([import('../clientes/formulario'), import('../../core/funciones')]);
    const [dup, r] = await Promise.all([clientePorNif(nif), llamarFuncion<{ nombre: string }>('clientes', { accion: 'nif', nif }, 25000)]);
    const n = document.getElementById('tf-nc-nombre') as HTMLInputElement;
    if (r.data?.nombre && !n.value.trim()) n.value = r.data.nombre;
    if (est) est.innerHTML = dup ? `⚠️ Ese NIF ya lo tiene <strong>${esc(dup.nombre)}</strong>: elígelo en el buscador de arriba.`
      : r.error ? `No se pudo buscar: ${esc(r.error)}` : r.data?.nombre ? `Encontrado: <strong>${esc(r.data.nombre)}</strong>` : 'No se ha encontrado el nombre en la web: escríbelo a mano.';
  },
  async tfNcCrear() {
    const nombre = val('tf-nc-nombre');
    if (!nombre) { toast('El nombre del cliente es obligatorio', 'error'); return; }
    const { crearCliente } = await import('../clientes/formulario');
    const r = await crearCliente({ nombre, nif: val('tf-nc-nif') || null, telefono: val('tf-nc-telefono') || null, email: val('tf-nc-email') || null });
    if (!r.id) { toast(r.error ?? 'No se pudo crear el cliente', 'error'); return; }
    toast(`Cliente creado (${r.zoho})`, r.zoho?.startsWith('no ') ? 'error' : 'info');
    (document.getElementById('tf-nc') as HTMLElement).hidden = true;
    await acciones.tfElegirCliente(r.id, nombre);
  },
  async tfNlCrear() {
    const nombre = val('tf-nl-nombre');
    if (!nombre) { toast('El nombre de la sede es obligatorio', 'error'); return; }
    const { confirmarSedeNoDuplicada, mapaDeDireccion } = await import('../sitios/formulario');
    if (!(await confirmarSedeNoDuplicada(nombre))) return;
    const dir = val('tf-nl-direccion');
    const clienteId = val('tf-cliente') || null;
    const r = await API.post<{ id: string }[]>('locales', {
      cliente_id: clienteId, nombre, direccion: dir || null, activo: true,
      maps_url: val('tf-nl-maps') || (dir ? mapaDeDireccion(dir) : null),
    });
    const nueva = r.data?.[0];
    if (r.error || !nueva) { toast(`No se pudo crear la sede: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
    const sel = document.getElementById('tf-local') as HTMLSelectElement | null;
    if (sel) { sel.insertAdjacentHTML('beforeend', `<option value="${esc(nueva.id)}">${esc(nombre)}</option>`); sel.value = nueva.id; }
    (document.getElementById('tf-nl') as HTMLElement).hidden = true;
    toast(`Sede «${nombre}» creada y elegida`);
  },
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
  // aplicarPlantilla de la app: tipo, descripción y duración (y el título, si
  // está vacío, que aquí es obligatorio). Lo tecleado en el resto se queda.
  tfPlantilla(id: string) {
    const p = _plantillas.find(x => x.id === id);
    if (!p) return;
    const pon = (campo: string, v: string) => { const el = document.getElementById(campo) as HTMLInputElement | null; if (el) el.value = v; };
    pon('tf-tipo', p.tipo);
    pon('tf-descripcion', p.descripcion ?? '');
    if (p.duracion_teorica) pon('tf-duracion', String(p.duracion_teorica));
    if (!val('tf-titulo')) pon('tf-titulo', p.nombre);
    toast(`Plantilla «${p.nombre}» aplicada`);
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
      if (val('tf-oportunidad')) cuerpo.oportunidad_id = val('tf-oportunidad');
      const r = await API.post<any[]>('trabajos', cuerpo);
      if (r.error || !r.data?.[0]) { toast(`No se pudo crear: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
      // Lo recién creado entra directo en la lista de quien lo va a hacer, el día en que toca (_aListaDia de la app).
      if ((document.getElementById('tf-lista') as HTMLInputElement | null)?.checked && tecnicos.length) {
        const { anadirALista } = await import('../lista-dia/vista');
        for (const persona of tecnicos) await anadirALista({ tipo: 'trabajo', refId: r.data[0].id, persona, fecha: fecha || undefined, asignarlo: false });
      }
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
};
registrarAcciones(acciones);
