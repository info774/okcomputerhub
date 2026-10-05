// Ficha del sitio: pestañas Software, Hardware y Cámaras (loadSoftware /
// loadHardware / loadCamaras de la app), Seguimiento del plan
// (loadSeguimientoLocal) y el acceso remoto (AnyDesk de hardware + software y
// RustDesk de Breeze con la contraseña de la sede, como la app).
// Espejos del área `clientes`: con el área de la app, solo lectura; al cortar,
// se añade, edita y quita aquí. Prefijos de ids: si-eq- y si-rem-.
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';

export type TipoEquipo = 'software' | 'hardware' | 'camaras';
interface Campo { k: string; t: string; tipo?: 'date' | 'select'; opciones?: string[] }

export const TIPOS_HARDWARE = ['TPV', 'Impresora', 'Access Point', 'Router', 'Switch', 'Móvil', 'Tablet', 'PC', 'Otro'];
const DEF: Record<TipoEquipo, { tabla: string; titulo: string; nuevo: string; vacio: string; campos: Campo[] }> = {
  software: {
    tabla: 'local_software', titulo: 'software', nuevo: 'Añadir software', vacio: 'Sin software registrado.',
    campos: [{ k: 'nombre', t: 'Nombre' }, { k: 'version', t: 'Versión' }, { k: 'num_licencia', t: 'Nº de licencia' },
      { k: 'fecha_caducidad_certificado', t: 'Caducidad del certificado', tipo: 'date' }, { k: 'notas', t: 'Notas' }],
  },
  hardware: {
    tabla: 'local_hardware', titulo: 'hardware', nuevo: 'Añadir equipo', vacio: 'Sin hardware registrado.',
    campos: [{ k: 'tipo', t: 'Tipo', tipo: 'select', opciones: TIPOS_HARDWARE }, { k: 'nombre', t: 'Nombre o modelo' },
      { k: 'num_serie', t: 'Nº de serie' }, { k: 'ip', t: 'IP' }, { k: 'anydesk_id', t: 'AnyDesk' },
      { k: 'fecha_instalacion', t: 'Instalado el', tipo: 'date' }, { k: 'garantia', t: 'Garantía hasta (instalación + 1 año)', tipo: 'date' },
      { k: 'notas', t: 'Notas' }],
  },
  camaras: {
    tabla: 'local_camaras', titulo: 'cámara', nuevo: 'Añadir cámara', vacio: 'Sin cámaras registradas.',
    campos: [{ k: 'marca', t: 'Marca' }, { k: 'modelo', t: 'Modelo' }, { k: 'num_serie', t: 'Nº de serie' }, { k: 'ip', t: 'IP' },
      { k: 'usuario', t: 'Usuario' }, { k: 'contrasena', t: 'Contraseña' }, { k: 'notas', t: 'Notas' }],
  },
};

let _filas = new Map<string, Record<string, any>>();
let _localId = '';

const fecha = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-ES');
/** Chip de caducidad (certificado, garantía): vencido, vence en ≤ 30 días o válido hasta. */
export function chipCaducidad(d: string | null | undefined, que: string): string {
  if (!d) return '';
  // Días de calendario (los dos a mediodía): con la hora de ahora, por la
  // mañana salía un día de más.
  const dias = Math.round((new Date(`${d.slice(0, 10)}T12:00:00`).getTime() - new Date(`${new Date().toLocaleDateString('sv-SE')}T12:00:00`).getTime()) / 86_400_000);
  if (dias < 0) return `<span class="chip mal">${esc(que)} vencido</span>`;
  if (dias <= 30) return `<span class="chip aviso">${esc(que)}: vence en ${dias} d</span>`;
  return `<span class="chip bien">${esc(que)} hasta ${esc(fecha(d))}</span>`;
}
const enlaceIp = (ip: string | null) => ip ? `<a href="http://${esc(ip)}" target="_blank" rel="noopener">${esc(ip)}</a>` : '';
const enlaceAnydesk = (id: string | null) => id ? `<a href="anydesk://${esc(id.replace(/\s+/g, ''))}">AnyDesk ${esc(id)}</a>` : '';

function celdas(tipo: TipoEquipo, f: Record<string, any>): string[] {
  if (tipo === 'software') return [
    `<strong>${esc(f.nombre ?? '—')}</strong>${f.version ? ` <span class="chip">${esc(f.version)}</span>` : ''}${f.anydesk_id ? `<br>${enlaceAnydesk(f.anydesk_id)}` : ''}`,
    esc(f.num_licencia ?? ''), chipCaducidad(f.fecha_caducidad_certificado, 'Certificado'), esc(f.notas ?? '')];
  if (tipo === 'hardware') return [
    `${f.tipo ? `<span class="chip">${esc(f.tipo)}</span> ` : ''}<strong>${esc(f.nombre ?? '—')}</strong>${f.num_serie ? `<br><small class="nota">S/N ${esc(f.num_serie)}</small>` : ''}`,
    [enlaceIp(f.ip), enlaceAnydesk(f.anydesk_id)].filter(Boolean).join('<br>'),
    `${f.fecha_instalacion ? `<small class="nota">Instalado el ${esc(fecha(f.fecha_instalacion))}</small><br>` : ''}${chipCaducidad(f.garantia, 'Garantía')}`,
    esc(f.notas ?? '')];
  return [
    `<strong>${esc([f.marca, f.modelo].filter(Boolean).join(' ') || '—')}</strong>${f.num_serie ? `<br><small class="nota">S/N ${esc(f.num_serie)}</small>` : ''}`,
    enlaceIp(f.ip), esc(f.usuario ?? ''),
    f.contrasena ? `<span data-clave="${esc(f.id)}">••••</span> <button class="btn secundario" data-action="siEqClave" data-p0="${esc(f.id)}" data-p1="$this">Ver</button>` : '',
    esc(f.notas ?? '')];
}
const CABECERA: Record<TipoEquipo, string[]> = {
  software: ['Programa', 'Licencia', 'Certificado', 'Notas'],
  hardware: ['Equipo', 'Acceso', 'Garantía', 'Notas'],
  camaras: ['Cámara', 'IP', 'Usuario', 'Contraseña', 'Notas'],
};

export async function tabEquipamiento(tipo: TipoEquipo, localId: string, escribe: boolean): Promise<string> {
  const d = DEF[tipo];
  const { data, error } = await API.get<Record<string, any>[]>(d.tabla, { select: '*', local_id: `eq.${localId}`, order: 'created_at.asc' });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  _localId = localId;
  const filas = data ?? [];
  _filas = new Map(filas.map(f => [String(f.id), f]));
  const tabla = filas.length ? `<div class="tarjeta mo-scroll"><table class="tabla" id="si-eq-tabla"><thead><tr>${CABECERA[tipo].map(c => `<th>${c}</th>`).join('')}${escribe ? '<th></th>' : ''}</tr></thead>
    <tbody>${filas.map(f => `<tr data-eq="${esc(f.id)}">${celdas(tipo, f).map(c => `<td>${c}</td>`).join('')}
      ${escribe ? `<td class="acciones"><button class="btn secundario" data-action="siEqEditar" data-p0="${esc(f.id)}" aria-label="Editar">${ico('editar')}</button>
        <button class="btn secundario" data-action="siEqBorrar" data-p0="${tipo}" data-p1="${esc(f.id)}" aria-label="Quitar">${ico('eliminar')}</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`
    : `<p class="vacio">${d.vacio}</p>`;
  if (!escribe) return tabla;
  const campo = (c: Campo) => c.tipo === 'select'
    ? `<label>${c.t} <select id="si-eq-${c.k}"><option value="">—</option>${(c.opciones ?? []).map(o => `<option>${esc(o)}</option>`).join('')}</select></label>`
    : `<label>${c.t} <input id="si-eq-${c.k}" ${c.tipo === 'date' ? 'type="date"' : ''} ${c.k === 'fecha_instalacion' ? 'data-on-input="siEqGarantia"' : ''} autocomplete="off"></label>`;
  return `${tabla}<form class="tarjeta" id="si-eq-form" data-on-submit="siEqGuardar:${tipo}" data-prevent="1"><h3 id="si-eq-titulo">${d.nuevo}</h3>
    <input type="hidden" id="si-eq-id"><div class="in-campos">${d.campos.map(campo).join('')}</div>
    <div class="acciones"><button class="btn" type="submit">Guardar</button>
      <button class="btn secundario" type="button" data-action="siEqLimpiar" data-p0="${tipo}">Limpiar</button></div></form>`;
}

// ── Seguimiento de las tareas del plan ──────────────────────────────────────
// plan_tareas: tareas de cada plan con su periodicidad. sitio_tarea_seguimiento:
// una fila SOLO cuando se marcó hecha en ese periodo (no se generan pendientes).
// periodoKey / periodoLabel / _segPeriodosRecientes de la app, tal cual.
const COLUMNAS_SEG: Record<string, number> = { mensual: 6, trimestral: 4, semestral: 4, anual: 3 };
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export function periodoKey(periodicidad: string, d = new Date()): string {
  const y = d.getFullYear(), m = d.getMonth();
  if (periodicidad === 'trimestral') return `${y}-T${Math.floor(m / 3) + 1}`;
  if (periodicidad === 'semestral') return `${y}-S${Math.floor(m / 6) + 1}`;
  if (periodicidad === 'anual') return `${y}`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}
export function periodoLabel(periodicidad: string, key: string): string {
  if (periodicidad === 'mensual') { const [y, m] = key.split('-'); return `${MESES[parseInt(m, 10) - 1]} ${y.slice(2)}`; }
  return key.replace('-', ' ');
}
export function periodosRecientes(periodicidad: string, hoy = new Date()): string[] {
  const n = COLUMNAS_SEG[periodicidad] ?? 6;
  const paso = periodicidad === 'mensual' ? 1 : periodicidad === 'trimestral' ? 3 : periodicidad === 'semestral' ? 6 : 12;
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(periodoKey(periodicidad, new Date(hoy.getFullYear(), hoy.getMonth() - i * paso, 1)));
  return out;
}

let _seg = new Map<string, { id: string }>();

export async function tabSeguimiento(localId: string, plan: string | null, escribe: boolean): Promise<string> {
  if (!plan || plan === 'Sin mantenimiento') return '<p class="vacio">Este sitio no tiene plan de mantenimiento contratado: no hay tareas que seguir.</p>';
  const [tareas, hechos] = await Promise.all([
    API.get<any[]>('plan_tareas', { select: 'id,nombre,periodicidad,es_backup', plan: `eq.${plan}`, activa: 'eq.true', order: 'orden.asc' }),
    API.get<any[]>('sitio_tarea_seguimiento', { select: 'id,tarea_id,periodo,completado_at', local_id: `eq.${localId}` }),
  ]);
  if (tareas.error || hechos.error) return `<p class="aviso mal">${esc((tareas.error ?? hechos.error)!.message)}</p>`;
  if (!(tareas.data ?? []).length) return `<p class="vacio">No hay tareas de seguimiento definidas todavía para el plan ${esc(plan)}.</p>`;
  _localId = localId;
  _seg = new Map((hechos.data ?? []).map(s => [`${s.tarea_id}|${s.periodo}`, s]));
  return `<div class="tarjeta"><p class="nota">Plan ${esc(plan)}. ${escribe ? 'Pulsa una casilla para marcarla hecha (o desmarcarla).' : 'Se marca en la app hasta el cambio.'} La última columna es el periodo actual.</p>
    <div class="si-seg">${(tareas.data ?? []).map(t => {
      const ps = periodosRecientes(t.periodicidad);
      return `<div class="si-seg-fila"><div class="si-seg-nombre">${esc(t.nombre)}${t.es_backup ? ' <span class="chip">Backup</span>' : ''} <small class="nota">${esc(t.periodicidad)}</small></div>
        <div class="si-seg-celdas">${ps.map((p, i) => {
          const s = _seg.get(`${t.id}|${p}`);
          const titulo = `${periodoLabel(t.periodicidad, p)}${s ? ' · hecho' : ''}`;
          return `<button type="button" class="si-seg-celda${s ? ' hecha' : ''}${i === ps.length - 1 ? ' actual' : ''}" title="${esc(titulo)}" aria-label="${esc(titulo)}"
            aria-pressed="${!!s}" ${escribe ? `data-action="siSegMarcar" data-p0="${esc(t.id)}" data-p1="${esc(p)}"` : 'disabled'}><span>${esc(periodoLabel(t.periodicidad, p))}</span>${s ? '✓' : ''}</button>`;
        }).join('')}</div></div>`;
    }).join('')}</div></div>`;
}

// ── Acceso remoto ───────────────────────────────────────────────────────────
export interface Remoto { tipo: 'anydesk' | 'rustdesk'; id: string; nombre: string }

/** AnyDesk de hardware + software (sin repetir) y RustDesk de los equipos de Breeze. */
export async function remotosDe(localId: string): Promise<Remoto[]> {
  const [hw, sw, rmm] = await Promise.all([
    API.get<any[]>('local_hardware', { select: 'anydesk_id,nombre,tipo', local_id: `eq.${localId}`, anydesk_id: 'not.is.null' }),
    API.get<any[]>('local_software', { select: 'anydesk_id,nombre', local_id: `eq.${localId}`, anydesk_id: 'not.is.null' }),
    API.get<any[]>('rmm_equipos', { select: 'hostname,rustdesk_id', local_id: `eq.${localId}`, rustdesk_id: 'not.is.null' }),
  ]);
  const out: Remoto[] = [];
  const vistos = new Set<string>();
  for (const x of [...(hw.data ?? []), ...(sw.data ?? [])]) {
    const id = String(x.anydesk_id ?? '').replace(/\s+/g, '');
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    out.push({ tipo: 'anydesk', id, nombre: [x.tipo, x.nombre].filter(Boolean).join(' · ') || 'Equipo' });
  }
  for (const e of rmm.data ?? []) {
    const id = String(e.rustdesk_id ?? '').replace(/\s+/g, '');
    if (id) out.push({ tipo: 'rustdesk', id, nombre: e.hostname ?? 'Equipo' });
  }
  return out;
}

const abrir = (url: string) => { window.open(url, '_blank'); };

/** RustDesk como la app: la contraseña de la sede al portapapeles y el cliente abierto. */
async function abrirRustDesk(id: string, localId: string) {
  const { data } = await API.get<{ rustdesk_password: string }[]>('rmm_despliegues', { select: 'rustdesk_password', local_id: `eq.${localId}`, limit: '1' });
  const pass = data?.[0]?.rustdesk_password;
  if (pass) {
    try { await navigator.clipboard.writeText(pass); toast('Contraseña copiada: pégala en RustDesk'); }
    catch { toast(`Contraseña: ${pass}`); }
  } else toast('Sin contraseña guardada para esta sede: búscala a mano', 'error');
  abrir(`rustdesk://${id}`);
}

export function abrirRemoto(r: Remoto, localId: string) {
  if (r.tipo === 'rustdesk') return abrirRustDesk(r.id, localId);
  abrir(`anydesk://${r.id}`);
}

let _remotos: Remoto[] = [];

registrarAcciones({
  async siRemoto(localId: string) {
    const caja = document.getElementById('si-rem-lista');
    if (caja && !caja.hidden) { caja.hidden = true; return; }
    _remotos = await remotosDe(localId);
    if (!_remotos.length) { toast('Este sitio no tiene AnyDesk ni RustDesk apuntado', 'error'); return; }
    if (_remotos.length === 1) { await abrirRemoto(_remotos[0], localId); return; }
    if (!caja) return;
    caja.innerHTML = `<p class="nota">¿A qué equipo?</p>${_remotos.map((r, i) => `<button class="btn secundario" data-action="siRemotoAbrir" data-p0="${i}" data-p1="${esc(localId)}">
      ${r.tipo === 'anydesk' ? 'AnyDesk' : 'RustDesk'} · ${esc(r.nombre)} <small class="nota">${esc(r.id)}</small></button>`).join('')}`;
    caja.hidden = false;
  },
  async siRemotoAbrir(i: string, localId: string) {
    const r = _remotos[Number(i)];
    if (r) await abrirRemoto(r, localId);
    const caja = document.getElementById('si-rem-lista'); if (caja) caja.hidden = true;
  },
  siEqClave(id: string, btn: HTMLElement) {
    const s = document.querySelector<HTMLElement>(`[data-clave="${CSS.escape(id)}"]`);
    const f = _filas.get(id);
    if (!s || !f?.contrasena) return;
    const ver = s.textContent === '••••';
    s.textContent = ver ? String(f.contrasena) : '••••';
    btn.textContent = ver ? 'Ocultar' : 'Ver';
  },
  siEqEditar(id: string) {
    const f = _filas.get(id);
    if (!f) return;
    (document.getElementById('si-eq-id') as HTMLInputElement).value = id;
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#si-eq-form [id^="si-eq-"]').forEach(el => {
      const k = el.id.slice(6);
      if (k !== 'id' && k !== 'form' && k !== 'titulo') el.value = f[k] ?? '';
    });
    const t = document.getElementById('si-eq-titulo'); if (t) t.textContent = 'Editar';
    document.getElementById('si-eq-form')?.scrollIntoView({ block: 'nearest' });
  },
  siEqLimpiar(tipo: TipoEquipo) {
    (document.getElementById('si-eq-form') as HTMLFormElement | null)?.reset();
    (document.getElementById('si-eq-id') as HTMLInputElement).value = '';
    const t = document.getElementById('si-eq-titulo'); if (t) t.textContent = DEF[tipo].nuevo;
  },
  // hwAutoGarantia de la app: garantía = instalación + 1 año.
  siEqGarantia() {
    const inst = (document.getElementById('si-eq-fecha_instalacion') as HTMLInputElement | null)?.value;
    const gar = document.getElementById('si-eq-garantia') as HTMLInputElement | null;
    if (!inst || !gar) return;
    const d = new Date(`${inst}T12:00:00`);
    d.setFullYear(d.getFullYear() + 1);
    gar.value = d.toISOString().slice(0, 10);
  },
  async siEqGuardar(tipo: TipoEquipo) {
    const d = DEF[tipo];
    const cuerpo: Record<string, unknown> = {};
    for (const c of d.campos) cuerpo[c.k] = (document.getElementById(`si-eq-${c.k}`) as HTMLInputElement | null)?.value.trim() || null;
    if (tipo === 'software' && !cuerpo.nombre) { toast('El nombre es obligatorio', 'error'); return; }
    if (tipo === 'hardware') {
      if (!cuerpo.nombre && !cuerpo.tipo) { toast('Indica el tipo o el nombre', 'error'); return; }
      cuerpo.nombre ??= cuerpo.tipo;
    }
    const id = (document.getElementById('si-eq-id') as HTMLInputElement).value;
    const r = id ? await API.patch(d.tabla, { id: `eq.${id}` }, cuerpo) : await API.post(d.tabla, { ...cuerpo, local_id: _localId });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    toast(id ? 'Guardado' : 'Añadido');
    resolver();
  },
  async siEqBorrar(tipo: TipoEquipo, id: string) {
    if (!confirm(`¿Quitar este ${DEF[tipo].titulo} del sitio?`)) return;
    const r = await API.delete(DEF[tipo].tabla, { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo quitar: ${r.error.message}`, 'error'); return; }
    toast('Quitado'); resolver();
  },
  async siSegMarcar(tareaId: string, periodo: string) {
    const clave = `${tareaId}|${periodo}`;
    const hecho = _seg.get(clave);
    const r = hecho
      ? await API.delete('sitio_tarea_seguimiento', { id: `eq.${hecho.id}` })
      : await API.post('sitio_tarea_seguimiento', { local_id: _localId, tarea_id: tareaId, periodo, completado: true, completado_por: usuario()?.id ?? null });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    resolver();
  },
});
