// Guía de instalación del trabajo (paridad bloque 8, tanda 4: la «Guía de
// instalación» de trabajos.js de la app). Un asistente por pasos para dejar
// apuntado lo que se instaló (TPV, cámaras, alarma Ajax, red, comanderos):
//   #/trabajos/<n>/instalacion                → elegir el tipo (crea la fila)
//   #/trabajos/<n>/instalacion/<id>           → el resumen (y editar un paso)
//   #/trabajos/<n>/instalacion/<id>/paso/<i>  → un paso; «/r» al final vuelve al resumen
// Las respuestas van a hub.instalaciones.datos con las MISMAS claves que la app
// (`<tipo>_<paso>_<campo>`). Al finalizar, como la app: el resumen se añade a
// las observaciones del trabajo, un trabajo Pendiente pasa a «En progreso»
// (por hub.trabajo_estado) y el equipo va a la ficha de la sede (hardware,
// software y cámaras; solo con el área `clientes` del hub). Escribir, con el
// área `trabajos` del hub (instalaciones está en ella); antes, se ve.
// Prefijo de ids: gi-.
import { API } from '../../core/api';
import { esAdmin, usuario } from '../../core/estado';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esc, toast, hace, pl } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { GUIA_TIPOS, textoOpcion, type TipoGuia } from './guia-tipos';

interface Instalacion { id: string; created_at: string; trabajo_id: string | null; local_id: string | null; tipo: string; datos: Record<string, string> | null; completada: boolean | null; tecnico_id: string | null }
interface TrabajoGuia { id: string; numero: number; titulo: string | null; estado: string; local_id: string | null; cliente_id: string | null; observaciones: string | null }

let _t: TrabajoGuia | null = null;
let _inst: Instalacion | null = null;
let _paso = 0;
let _volverResumen = false;

const clave = (tipo: string, paso: string, campo: string) => `${tipo}_${paso}_${campo}`;
const tipoDe = (i: Instalacion): TipoGuia | null => GUIA_TIPOS[i.tipo] ?? null;

/** La sección «Instalaciones» de la ficha del trabajo. */
export async function seccionInstalaciones(t: { id: string; numero: number }, escribe: boolean): Promise<string> {
  const { data } = await API.get<Instalacion[]>('instalaciones', { select: 'id,created_at,tipo,completada', trabajo_id: `eq.${t.id}`, order: 'created_at' });
  const lista = (data ?? []).filter(i => GUIA_TIPOS[i.tipo]);
  if (!lista.length && !escribe) return '';
  return `<section class="tarjeta" id="gi-lista"><h3>Instalaciones${lista.length ? ` <span class="chip">${lista.length}</span>` : ''}</h3>
    ${lista.length ? `<ul class="gi-lista">${lista.map(i => `<li><a href="#/trabajos/${t.numero}/instalacion/${esc(i.id)}">${ico(GUIA_TIPOS[i.tipo].icono)} ${esc(GUIA_TIPOS[i.tipo].nombre)}</a>
      <span class="chip ${i.completada ? 'bien' : 'atento'}">${i.completada ? 'Completada' : 'En progreso'}</span> <small class="nota">${esc(hace(i.created_at))}</small></li>`).join('')}</ul>`
      : '<p class="nota">Ninguna todavía.</p>'}
    ${escribe ? `<p class="acciones"><a class="btn secundario" href="#/trabajos/${t.numero}/instalacion">${ico('lista')} Guía de instalación</a></p>` : ''}</section>`;
}

async function cargarTrabajo(numero: string) {
  const n = Number(numero);
  const { data } = await API.single<TrabajoGuia>('trabajos', { select: 'id,numero,titulo,estado,local_id,cliente_id,observaciones', ...(n ? { numero: `eq.${n}` } : { id: `eq.${numero}` }) });
  _t = data ?? null;
  return _t;
}

const cab = (t: TrabajoGuia, titulo: string) => `<p><a href="#/trabajos/${t.numero}">← Trabajo #${t.numero}${t.titulo ? ` · ${esc(t.titulo)}` : ''}</a></p><h2>${titulo}</h2>`;

function pintarSelector(el: HTMLElement, t: TrabajoGuia) {
  el.innerHTML = `${cab(t, 'Nueva instalación')}<p class="nota">Elige qué se instala: la guía va paso a paso y guarda lo que vayas apuntando.</p>
    <div class="gi-tipos">${Object.entries(GUIA_TIPOS).map(([k, tipo]) => `<button type="button" class="tarjeta gi-tipo" data-action="giIniciar" data-p0="${k}">
      <span class="gi-ico">${ico(tipo.icono)}</span><strong>${esc(tipo.nombre)}</strong><small class="nota">${tipo.pasos.length} pasos</small></button>`).join('')}</div>`;
}

function campoHtml(tipo: string, pasoId: string, c: TipoGuia['pasos'][number]['campos'][number], datos: Record<string, string>) {
  const v = datos[clave(tipo, pasoId, c.id)] ?? c.default ?? '';
  const id = `gi-c-${c.id}`;
  if (c.tipo === 'select') return `<label>${esc(c.label)} <select id="${id}" data-campo="${esc(c.id)}">${(c.opciones ?? []).map(o => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(textoOpcion(o))}</option>`).join('')}</select></label>`;
  if (c.tipo === 'textarea') return `<label>${esc(c.label)} <textarea id="${id}" data-campo="${esc(c.id)}" rows="3" placeholder="${esc(c.placeholder ?? '')}">${esc(v)}</textarea></label>`;
  return `<label>${esc(c.label)} <input id="${id}" data-campo="${esc(c.id)}" type="${c.tipo === 'password' ? 'password' : c.tipo === 'date' ? 'date' : c.tipo === 'number' ? 'number' : 'text'}"
    placeholder="${esc(c.placeholder ?? '')}" value="${esc(v)}" autocomplete="off"></label>`;
}

function pintarPaso(el: HTMLElement, t: TrabajoGuia, inst: Instalacion, escribe: boolean) {
  const tipo = tipoDe(inst)!;
  const total = tipo.pasos.length;
  const paso = tipo.pasos[_paso];
  const ultimo = _paso === total - 1;
  el.innerHTML = `${cab(t, `${ico(tipo.icono)} ${esc(tipo.nombre)}`)}
    ${escribe ? '' : avisoSoloLectura('Las instalaciones')}
    <div class="gi-progreso"><span>Paso ${_paso + 1} de ${total}</span><div><div class="gi-barra" style="width:${Math.round(((_paso + 1) / total) * 100)}%"></div></div></div>
    <form class="tarjeta gi-paso" id="gi-form" data-on-submit="giSiguiente" data-prevent="1">
      <h3>${esc(paso.titulo)}</h3><p class="nota">${esc(paso.desc)}</p>
      <div class="in-campos">${paso.campos.map(c => campoHtml(inst.tipo, paso.id, c, inst.datos ?? {})).join('')}</div>
      <div class="acciones"><button type="button" class="btn secundario" data-action="giAnterior" ${_paso === 0 || _volverResumen ? 'disabled' : ''}>${ico('izquierda')} Anterior</button>
        <button type="submit" class="btn" id="gi-siguiente" ${escribe ? '' : 'disabled'}>${_volverResumen ? `${ico('hecho')} Guardar y volver` : ultimo ? `${ico('hecho')} Finalizar` : `Siguiente ${ico('derecha')}`}</button></div>
    </form>`;
}

function todoBien(inst: Instalacion) {
  // La regla de la app: las pruebas (claves con «test_») están en OK o N/A.
  return Object.entries(inst.datos ?? {}).filter(([k]) => k.includes('test_')).every(([, v]) => String(v).includes('✅') || String(v).includes('N/A'));
}

function pintarResumen(el: HTMLElement, t: TrabajoGuia, inst: Instalacion, escribe: boolean) {
  const tipo = tipoDe(inst)!;
  const d = inst.datos ?? {};
  const ok = todoBien(inst);
  el.innerHTML = `${cab(t, `${ico(tipo.icono)} ${esc(tipo.nombre)}`)}
    ${escribe ? '' : avisoSoloLectura('Las instalaciones')}
    <section class="tarjeta gi-estado ${inst.completada ? (ok ? 'bien' : 'atento') : ''}"><h3>${inst.completada ? (ok ? `${ico('hecho')} Instalación completada` : `${ico('atencion')} Instalación con incidencias`) : `${ico('espera')} En progreso`}</h3>
      <p class="nota">${esc(tipo.nombre)}${inst.tecnico_id ? ` · ${esc(inst.tecnico_id)}` : ''} · ${esc(hace(inst.created_at))}</p>
      ${!inst.completada && escribe ? `<p class="acciones"><a class="btn" href="#/trabajos/${t.numero}/instalacion/${esc(inst.id)}/paso/0">Seguir con la guía</a></p>` : ''}</section>
    ${tipo.pasos.map((p, i) => {
      const filas = p.campos.filter(c => d[clave(inst.tipo, p.id, c.id)]);
      return `<section class="tarjeta"><div class="tarjeta-cab"><h3>${esc(p.titulo)}</h3>${escribe ? `<a class="btn secundario" href="#/trabajos/${t.numero}/instalacion/${esc(inst.id)}/paso/${i}/r">${ico('editar')} Editar</a>` : ''}</div>
        ${filas.length ? `<dl class="tk-dl gi-dl">${filas.map(c => `<dt>${esc(c.label)}</dt><dd>${c.tipo === 'password' ? '••••••••' : esc(c.tipo === 'select' ? textoOpcion(d[clave(inst.tipo, p.id, c.id)]) : d[clave(inst.tipo, p.id, c.id)])}</dd>`).join('')}</dl>` : '<p class="nota">Sin datos.</p>'}</section>`;
    }).join('')}
    <div class="acciones"><a class="btn secundario" href="#/trabajos/${t.numero}">${ico('izquierda')} Trabajo</a>
      ${escribe ? `<a class="btn secundario" href="#/trabajos/${t.numero}/instalacion">${ico('mas')} Otra</a>` : ''}
      ${escribe && esAdmin() ? '<button class="btn peligro" data-action="giBorrar">Eliminar</button>' : ''}</div>`;
}

/** #/trabajos/<n>/instalacion[/<id>[/paso/<i>[/r]]] */
export async function pintarGuia(el: HTMLElement, numero: string, resto: string[]) {
  const [t, escribe] = await Promise.all([cargarTrabajo(numero), esDelHub('instalaciones', 'trabajos')]);
  if (!t) { el.innerHTML = '<p class="aviso mal">No existe ese trabajo.</p><p><a href="#/trabajos">← Trabajos</a></p>'; return; }
  const [id, que, i, r] = resto;
  if (!id) { if (!escribe) { el.innerHTML = `${cab(t, 'Guía de instalación')}${avisoSoloLectura('Las instalaciones')}`; return; } pintarSelector(el, t); return; }
  const { data } = await API.single<Instalacion>('instalaciones', { select: '*', id: `eq.${id}` });
  if (!data || !tipoDe(data)) { el.innerHTML = `${cab(t, 'Guía de instalación')}<p class="aviso mal">No existe esa instalación.</p>`; return; }
  _inst = { ...data, datos: data.datos ?? {} };
  if (que === 'paso') {
    _paso = Math.max(0, Math.min(Number(i) || 0, tipoDe(_inst)!.pasos.length - 1));
    _volverResumen = r === 'r';
    pintarPaso(el, t, _inst, escribe);
    return;
  }
  pintarResumen(el, t, _inst, escribe);
}

// Lo del formulario del paso en curso, a `datos`.
function recoger() {
  if (!_inst) return;
  const paso = tipoDe(_inst)!.pasos[_paso];
  for (const c of paso.campos) {
    const v = (document.getElementById(`gi-c-${c.id}`) as HTMLInputElement | null)?.value ?? '';
    _inst.datos![clave(_inst.tipo, paso.id, c.id)] = v;
  }
}

// El equipo instalado, a la ficha de la sede (saveGuiaDatosToLocal de la app).
async function guardarEnSede(inst: Instalacion, localId: string) {
  const d = inst.datos ?? {}, k = (p: string, c: string) => d[clave(inst.tipo, p, c)] || null;
  const hw: Record<string, unknown>[] = [], sw: Record<string, unknown>[] = [], cams: Record<string, unknown>[] = [];
  if (inst.tipo === 'tpv') {
    if (k('hardware', 'modelo_tpv')) hw.push({ tipo: 'TPV', nombre: k('hardware', 'modelo_tpv'), num_serie: k('hardware', 'serie_tpv'), ip: k('red', 'ip_tpv') });
    if (k('hardware', 'ip_impresora')) hw.push({ tipo: 'Impresora', nombre: 'Impresora tickets', ip: k('hardware', 'ip_impresora'), num_serie: k('hardware', 'serie_impr') });
    if (k('software', 'sw_nombre')) sw.push({ nombre: k('software', 'sw_nombre'), version: k('software', 'sw_version'), num_licencia: k('software', 'sw_licencia'),
      anydesk_id: k('software', 'anydesk'), fecha_caducidad_certificado: k('verifactu', 'vf_caducidad') });
  }
  if (inst.tipo === 'camaras') {
    if (k('red_cam', 'ip_nvr')) hw.push({ tipo: 'NVR', nombre: 'NVR', ip: k('red_cam', 'ip_nvr'), num_serie: k('red_cam', 'serie_nvr') });
    for (let n = 1; n <= 4; n++) {
      const ip = k('camaras_lista', `cam${n}_ip`);
      if (ip) cams.push({ ip, usuario: k('red_cam', 'usuario_nvr'), contrasena: k('red_cam', 'pass_nvr'), notas: k('camaras_lista', `cam${n}_ubi`) });
    }
  }
  if (inst.tipo === 'alarma') {
    if (k('hub_ajax', 'hub_modelo')) hw.push({ tipo: 'Alarma', nombre: `Ajax ${k('hub_ajax', 'hub_modelo')}`, num_serie: k('hub_ajax', 'hub_serie') });
    if (k('config_ajax', 'usuario_ajax')) sw.push({ nombre: 'Ajax PRO', notas: `Usuario: ${k('config_ajax', 'usuario_ajax')}${k('hub_ajax', 'hub_id') ? ` · ID: ${k('hub_ajax', 'hub_id')}` : ''}` });
  }
  if (inst.tipo === 'red' && k('wifi', 'modelo_ap')) hw.push({ tipo: 'Redes', nombre: k('wifi', 'modelo_ap'), ip: k('wifi', 'ip_ap') });
  const id = () => crypto.randomUUID();
  for (const x of hw) await API.post('local_hardware', { id: id(), local_id: localId, ...x });
  for (const x of sw) await API.post('local_software', { id: id(), local_id: localId, ...x });
  for (const x of cams) await API.post('local_camaras', { id: id(), local_id: localId, ...x });
  return hw.length + sw.length + cams.length;
}

async function finalizar() {
  if (!_inst || !_t) return;
  const inst = _inst, t = _t, tipo = tipoDe(inst)!;
  const r = await API.patch('instalaciones', { id: `eq.${inst.id}` }, { datos: inst.datos, completada: true });
  if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
  // El resumen a las observaciones del trabajo, como la app (campo: valor).
  const resumen = Object.entries(inst.datos ?? {}).filter(([, v]) => v).map(([k, v]) => `${k.split('_').slice(2).join('_')}: ${v}`).join('\n');
  const obs = t.observaciones ? `${t.observaciones}\n\n[${tipo.nombre}]\n${resumen}` : `[${tipo.nombre}]\n${resumen}`;
  const e = await API.patch('trabajos', { id: `eq.${t.id}` }, { observaciones: obs });
  if (e.error) toast(`Guardada, pero no en las observaciones del trabajo: ${e.error.message}`, 'error');
  // La app lo pasa a «En progreso»; aquí solo si estaba Pendiente (el estado va siempre por hub.trabajo_estado).
  if (t.estado === 'Pendiente') await API.rpc('trabajo_estado', { p_id: t.id, p_estado: 'En progreso' });
  let enSede = 0;
  if (t.local_id && await esDelHub('local_hardware', 'local_software', 'local_camaras')) enSede = await guardarEnSede(inst, t.local_id).catch(() => 0);
  toast(`Instalación completada${enSede ? ` · ${pl(enSede, 'equipo', 'equipos')} a la ficha de la sede` : ''}`);
  ir('trabajos', String(t.numero), 'instalacion', inst.id);
}

registrarAcciones({
  async giIniciar(tipo: string) {
    if (!_t || !GUIA_TIPOS[tipo]) return;
    const r = await API.post<Instalacion[]>('instalaciones', { id: crypto.randomUUID(), trabajo_id: _t.id, local_id: _t.local_id, tipo, datos: {}, completada: false, tecnico_id: usuario()?.nombre ?? null });
    if (r.error || !r.data?.[0]) { toast(`No se pudo empezar: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
    ir('trabajos', String(_t.numero), 'instalacion', r.data[0].id, 'paso', '0');
  },
  giAnterior() {
    if (!_inst || !_t || _paso === 0) return;
    recoger();
    void API.patch('instalaciones', { id: `eq.${_inst.id}` }, { datos: _inst.datos });
    ir('trabajos', String(_t.numero), 'instalacion', _inst.id, 'paso', String(_paso - 1));
  },
  async giSiguiente() {
    if (!_inst || !_t) return;
    recoger();
    const total = tipoDe(_inst)!.pasos.length;
    if (!_volverResumen && _paso === total - 1) { await finalizar(); return; }
    const r = await API.patch('instalaciones', { id: `eq.${_inst.id}` }, { datos: _inst.datos });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    if (_volverResumen) { toast('Guardado'); ir('trabajos', String(_t.numero), 'instalacion', _inst.id); return; }
    ir('trabajos', String(_t.numero), 'instalacion', _inst.id, 'paso', String(_paso + 1));
  },
  async giBorrar() {
    if (!_inst || !_t || !confirm('¿Eliminar esta instalación? Se perderán todos sus datos.')) return;
    const r = await API.delete('instalaciones', { id: `eq.${_inst.id}` });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Instalación eliminada');
    ir('trabajos', String(_t.numero));
  },
});
