// Vista del tablero VeriFactu (ver index.ts y reglas.ts). Kanban por fase con
// los carriles como filtro, buscador y ficha de la sede. ESPEJO: con el área
// `verifactu` de la app se ve y no se mueve; tras el cambio, arrastrar o el
// selector de la tarjeta mueven de fase (avisando de lo que falta al AVANZAR,
// sin bloquear), la ficha guarda y «Cargar sedes con TPV» mete en «Censo» las
// sedes activas con TPV que aún no están. Prefijo de ids: vf-.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { FASES, CARRILES, CHECKLIST, PLAZO_SOCIEDAD, PLAZO_AUTONOMO, tipoPorNif, carrilPara, plazoDe, diasHasta, dodPendiente, hechas, indiceFase, type SedeVf } from './reglas';

interface Nombre { id: string; nombre: string; nif?: string | null; cliente_id?: string | null; programa_tpv?: string | null }

let _sedes: SedeVf[] = [];
let _locales = new Map<string, Nombre>();
let _clientes = new Map<string, Nombre>();
let _carril = '';
let _q = '';
let _escribe = false;
let _arrastrando: string | null = null;

const ORDEN: Record<string, number> = { urgente: 0, compleja: 1, estandar: 2 };
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const nombreSede = (v: SedeVf) => _locales.get(v.local_id)?.nombre ?? 'Sede';
const nombreCli = (v: SedeVf) => (v.cliente_id && _clientes.get(v.cliente_id)?.nombre) || '—';

async function cargar() {
  const [s, escribe] = await Promise.all([API.fetchAll<SedeVf>('verifactu_sedes', { select: '*', order: 'created_at' }), esDelHub('verifactu_sedes')]);
  if (s.error) return s.error;
  _sedes = s.data ?? []; _escribe = escribe;
  const ids = (k: 'local_id' | 'cliente_id') => [...new Set(_sedes.map(v => v[k]).filter(Boolean) as string[])];
  const leer = async (tabla: string, select: string, xs: string[]) => {
    const out: Nombre[] = [];
    for (let i = 0; i < xs.length; i += 150) out.push(...((await API.get<Nombre[]>(tabla, { select, id: `in.(${xs.slice(i, i + 150).join(',')})` })).data ?? []));
    return new Map(out.map(x => [x.id, x]));
  };
  [_locales, _clientes] = await Promise.all([leer('locales', 'id,nombre,cliente_id,programa_tpv', ids('local_id')), leer('clientes', 'id,nombre,nif', ids('cliente_id'))]);
  return null;
}

function filtradas() {
  const q = _q.toLowerCase();
  return _sedes.filter(v => (!_carril || v.carril === _carril)
    && (!q || [nombreSede(v), nombreCli(v), v.software_origen, v.tecnico].some(s => (s ?? '').toLowerCase().includes(q))));
}

function tarjeta(v: SedeVf) {
  const car = CARRILES[v.carril] ?? CARRILES.estandar;
  const plazo = plazoDe(v), d = diasHasta(plazo), falta = dodPendiente(v).length;
  return `<article class="pr-tarjeta vf-tarjeta vf-${esc(v.carril)}" ${_escribe ? `draggable="true" data-on-dragstart="vfArrastrar:$this" data-on-dragend="vfSoltarFin"` : ''}
      data-id="${esc(v.id)}" data-action="vfAbrir" data-p0="${esc(v.id)}">
    <h4>${esc(nombreSede(v))}</h4>
    <p class="nota">${esc(nombreCli(v))}${v.software_origen ? ` · ${esc(v.software_origen)}` : ''}</p>
    <div class="pr-tarjeta-pie">
      <span class="chip ${car.tono}">${car.nombre}</span>
      <span class="${d < 0 ? 'g-mal' : d <= 60 ? 'g-aviso' : ''}" title="Plazo">${ico('calendario')} ${d < 0 ? 'Vencido' : esc(plazo)}</span>
      <span title="Casillas del proceso">${ico('casilla')} ${hechas(v)}/${CHECKLIST.length}</span>
      ${falta ? `<span class="g-aviso" title="Falta para pasar de fase">${ico('atencion')} ${falta}</span>` : ''}
      ${v.tecnico ? `<span>${ico('persona')} ${esc(v.tecnico)}</span>` : ''}
    </div>
    ${_escribe ? `<select class="vf-mover" data-action="nada" data-stop="1" data-on-change="vfMoverSel:${esc(v.id)},$value" aria-label="Fase de ${esc(nombreSede(v))}">
      ${FASES.map(f => `<option value="${f.key}" ${f.key === v.fase ? 'selected' : ''}>${f.nombre}</option>`).join('')}</select>` : ''}
  </article>`;
}

async function pintarTablero(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const err = await cargar();
  if (err) { el.innerHTML = `<p class="aviso mal">No se pudo leer el tablero: ${esc(err.message)}</p>`; return; }
  const abiertas = (c: string) => _sedes.filter(v => v.carril === c && v.fase !== 'cierre').length;
  const terminadas = _sedes.filter(v => v.fase === 'cierre' && v.checklist?.monitoreo_7_dias).length;
  const lista = filtradas();
  const chip = (k: string, n: number, t: string, sub: string, tono = '') => `<button type="button" class="tarjeta di-cifra vf-carril ${tono} ${_carril === k ? 'activo' : ''}" data-action="vfCarril" data-p0="${k}" aria-pressed="${_carril === k}">
    <h3>${esc(t)}</h3><p class="di-valor">${n}</p><p class="nota">${esc(sub)}</p></button>`;
  el.innerHTML = `${_escribe ? '' : avisoSoloLectura('El tablero VeriFactu')}
    <p class="nota">${diasHasta(PLAZO_SOCIEDAD)} días para sociedades (1/1/2027) · ${diasHasta(PLAZO_AUTONOMO)} para autónomos (1/7/2027). Mover de fase avisa de lo que falta, no lo impide.</p>
    <div class="di-cifras pp-cifras vf-cifras">${chip('', _sedes.length, 'Todas', `${terminadas} terminadas`)}
      ${Object.entries(CARRILES).map(([k, c]) => chip(k, abiertas(k), c.nombre, c.desc, k === 'urgente' ? 'mal' : k === 'compleja' ? 'atento' : '')).join('')}</div>
    <div class="acciones mo-barra"><input id="vf-q" type="search" placeholder="Buscar sede, cliente, TPV o técnico…" value="${esc(_q)}" data-on-input="vfBuscar:$value" aria-label="Buscar">
      ${_escribe ? `<button class="btn secundario" data-action="vfCargar">${ico('mas')} Cargar sedes con TPV</button>` : ''}</div>
    ${_sedes.length ? `<div class="pr-kanban vf-kanban">${FASES.map(f => {
      const col = lista.filter(v => v.fase === f.key).sort((a, b) => (ORDEN[a.carril] ?? 3) - (ORDEN[b.carril] ?? 3) || plazoDe(a).localeCompare(plazoDe(b)));
      return `<section class="pr-columna" data-fase="${f.key}" ${_escribe ? `data-on-dragover="vfSobre:$this" data-prevent="1" data-on-dragleave="vfFuera:$this" data-on-drop="vfSoltar:${f.key}"` : ''}>
        <header><h3>${f.nombre}</h3><span class="chip">${col.length}</span></header>
        <div class="pr-col-cuerpo">${col.map(tarjeta).join('') || '<p class="vacio col-vacia">—</p>'}</div></section>`;
    }).join('')}</div>` : `<p class="vacio">Tablero vacío.${_escribe ? ' Carga las sedes que tienen TPV para empezar el censo.' : ''}</p>`}`;
}

const sel = (id: string, opciones: [string, string][], actual: string | null, dis: string) =>
  `<select id="${id}" ${dis}>${opciones.map(([k, t]) => `<option value="${esc(k)}" ${k === (actual ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;

async function pintarFicha(el: HTMLElement, id: string) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  if (!_sedes.length) { const err = await cargar(); if (err) { el.innerHTML = `<p class="aviso mal">${esc(err.message)}</p>`; return; } }
  const v = _sedes.find(x => x.id === id);
  if (!v) { el.innerHTML = '<p class="aviso mal">Esa sede no está en el tablero.</p><p><a href="#/verifactu">← VeriFactu</a></p>'; return; }
  const dis = _escribe ? '' : 'disabled';
  const falta = dodPendiente(v);
  const cli = v.cliente_id ? _clientes.get(v.cliente_id) : null;
  const t = (id2: string, txt: string, valor: string | null, tipo = 'text') => `<label>${txt} <input id="${id2}" type="${tipo}" value="${esc(valor ?? '')}" ${dis}></label>`;
  el.innerHTML = `<p><a href="#/verifactu">← VeriFactu</a></p>${_escribe ? '' : avisoSoloLectura('El tablero VeriFactu')}
    <form class="tarjeta" id="vf-form" data-on-submit="vfGuardar" data-prevent="1" data-id="${esc(v.id)}">
      <div class="tarjeta-cab"><h2>${esc(nombreSede(v))}</h2><a class="btn secundario" href="#/sitios/${esc(v.local_id)}">${ico('ubicacion')} Ver la sede</a></div>
      <p class="nota">${esc([cli?.nombre, cli?.nif].filter(Boolean).join(' · ') || 'Sin cliente')}</p>
      ${falta.length ? `<p class="aviso">${ico('atencion')} <strong>Para salir de «${esc(FASES[indiceFase(v.fase)]?.nombre ?? v.fase)}» falta:</strong> ${esc(falta.join(', '))}</p>` : ''}
      <h3>Proceso</h3><div class="in-campos">
        <label>Fase ${sel('vf-fase', FASES.map(f => [f.key, f.nombre]), v.fase, dis)}</label>
        <label>Carril ${sel('vf-carril', Object.entries(CARRILES).map(([k, c]) => [k, c.nombre]), v.carril, dis)}</label>
        <label>Contribuyente ${sel('vf-tipo', [['', '— Sin decidir —'], ['Sociedad', 'Sociedad'], ['Autonomo', 'Autónomo']], v.tipo_contribuyente, dis)}</label>
        <label>Camino ${sel('vf-camino', [['', '—'], ['actualizacion', 'Actualización'], ['migracion', 'Migración']], v.camino, dis)}</label>
        ${t('vf-sw-origen', 'Software actual', v.software_origen)}${t('vf-sw-destino', 'Software destino', v.software_destino)}
        ${t('vf-fecha-obj', 'Fecha objetivo', v.fecha_objetivo, 'date')}${t('vf-tecnico', 'Técnico', v.tecnico)}${t('vf-golive', 'Go-live', v.fecha_go_live, 'date')}</div>
      <h3>Auditoría técnica</h3><div class="in-campos">
        ${t('vf-hw-tipo', 'Tipo de TPV', v.hw_tipo_tpv)}${t('vf-hw-so', 'Sistema', v.hw_sistema)}${t('vf-hw-disco', 'Almacenamiento', v.hw_almacenamiento)}${t('vf-hw-ram', 'RAM', v.hw_ram)}
        <label>Estado del hardware ${sel('vf-hw-estado', [['', '—'], ['Apto', 'Apto'], ['Requiere ampliacion', 'Requiere ampliación'], ['Sustitucion obligatoria', 'Sustitución obligatoria']], v.hw_estado, dis)}</label>
        ${t('vf-imp-modelo', 'Impresora', v.impresora_modelo)}${t('vf-imp-interfaz', 'Interfaz', v.impresora_interfaz)}
        <label>¿Imprime el QR? ${sel('vf-imp-qr', [['', 'Sin probar'], ['true', 'Sí'], ['false', 'No']], v.impresora_qr_ok == null ? '' : String(v.impresora_qr_ok), dis)}</label></div>
      <label class="check"><input id="vf-presupuesto" type="checkbox" ${v.presupuesto_aceptado ? 'checked' : ''} ${dis}> Presupuesto aceptado</label>
      <h3>Casillas (${hechas(v)}/${CHECKLIST.length})</h3>
      <div class="vf-checklist" id="vf-checklist">${CHECKLIST.map(c => `<label class="check"><input type="checkbox" data-ck="${c.key}" ${v.checklist?.[c.key] ? 'checked' : ''} ${dis}> ${esc(c.label)}</label>`).join('')}</div>
      <label>Notas <textarea id="vf-notas" rows="3" ${dis}>${esc(v.notas ?? '')}</textarea></label>
      <div class="acciones"><button class="btn" type="submit" ${dis}>Guardar</button>
        ${_escribe && esAdmin() ? `<button type="button" class="btn peligro" data-action="vfQuitar" data-p0="${esc(v.id)}">Quitar del tablero</button>` : ''}</div>
    </form>`;
}

export async function pintarVerifactu(el: HTMLElement, params: string[]) {
  if (params[0]) await pintarFicha(el, params[0]); else await pintarTablero(el);
}

async function mover(id: string, fase: string) {
  const v = _sedes.find(x => x.id === id);
  if (!v || v.fase === fase) return;
  // Solo se avisa al AVANZAR: volver atrás no necesita criterio de salida.
  const falta = indiceFase(fase) > indiceFase(v.fase) ? dodPendiente(v) : [];
  const r = await API.patch('verifactu_sedes', { id: `eq.${id}` }, { fase });
  if (r.error) { toast(`No se pudo mover: ${r.error.message}`, 'error'); return; }
  v.fase = fase;
  toast(falta.length ? `Movida. Pendiente de la fase anterior: ${falta.join(', ')}` : 'Movida');
  resolver();
}

let _timer: number | undefined;
registrarAcciones({
  vfAbrir(id: string) { ir('verifactu', id); },
  vfCarril(k: string) { _carril = _carril === k ? '' : k; resolver(); },
  vfBuscar(q: string) {
    _q = q; clearTimeout(_timer);
    _timer = window.setTimeout(() => { resolver(); window.setTimeout(() => { const f = document.getElementById('vf-q') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(q.length, q.length); }, 60); }, 250);
  },
  vfArrastrar(el: HTMLElement) { _arrastrando = el.dataset.id ?? null; el.classList.add('arrastrando'); },
  vfSoltarFin() { _arrastrando = null; document.querySelectorAll('.arrastrando,.sobre').forEach(e => e.classList.remove('arrastrando', 'sobre')); },
  vfSobre(el: HTMLElement) { el.classList.add('sobre'); },
  vfFuera(el: HTMLElement) { el.classList.remove('sobre'); },
  async vfSoltar(fase: string) { document.querySelectorAll('.sobre').forEach(e => e.classList.remove('sobre')); if (_arrastrando) await mover(_arrastrando, fase); },
  async vfMoverSel(id: string, fase: string) { await mover(id, fase); },
  async vfCargar() {
    const [locs, ya] = await Promise.all([
      API.fetchAll<Nombre>('locales', { select: 'id,nombre,cliente_id,programa_tpv', activo: 'eq.true', programa_tpv: 'not.is.null' }),
      API.fetchAll<{ local_id: string }>('verifactu_sedes', { select: 'local_id' })]);
    if (locs.error) { toast('No se pudieron leer las sedes', 'error'); return; }
    const dentro = new Set((ya.data ?? []).map(r => r.local_id));
    const candidatas = (locs.data ?? []).filter(l => (l.programa_tpv ?? '').trim() && !dentro.has(l.id));
    if (!candidatas.length) { toast('Todas las sedes con TPV ya están en el tablero'); return; }
    const cids = [...new Set(candidatas.map(l => l.cliente_id).filter(Boolean) as string[])];
    const nifs = new Map<string, string | null>();
    for (let i = 0; i < cids.length; i += 150) for (const c of (await API.get<Nombre[]>('clientes', { select: 'id,nif', id: `in.(${cids.slice(i, i + 150).join(',')})` })).data ?? []) nifs.set(c.id, c.nif ?? null);
    if (!confirm(`Se añadirán ${candidatas.length} sedes a «Censo».`)) return;
    const nuevas = candidatas.map(l => { const tipo = tipoPorNif(l.cliente_id ? nifs.get(l.cliente_id) : null);
      return { local_id: l.id, cliente_id: l.cliente_id ?? null, fase: 'censo', software_origen: l.programa_tpv, tipo_contribuyente: tipo, carril: carrilPara(tipo, l.programa_tpv) }; });
    const r = await API.post('verifactu_sedes', nuevas);
    if (r.error) { toast(`No se pudieron añadir: ${r.error.message}`, 'error'); return; }
    toast(`${nuevas.length} sedes añadidas`);
    resolver();
  },
  async vfGuardar() {
    const id = (document.getElementById('vf-form') as HTMLElement).dataset.id!;
    const v = _sedes.find(x => x.id === id);
    if (!v) return;
    const checklist: Record<string, boolean> = { ...(v.checklist ?? {}) };
    document.querySelectorAll<HTMLInputElement>('#vf-checklist [data-ck]').forEach(c => { checklist[c.dataset.ck!] = c.checked; });
    const qr = val('vf-imp-qr');
    const cambios = { fase: val('vf-fase'), carril: val('vf-carril'), tipo_contribuyente: val('vf-tipo') || null, camino: val('vf-camino') || null,
      software_origen: val('vf-sw-origen') || null, software_destino: val('vf-sw-destino') || null, fecha_objetivo: val('vf-fecha-obj') || null,
      tecnico: val('vf-tecnico') || null, hw_tipo_tpv: val('vf-hw-tipo') || null, hw_sistema: val('vf-hw-so') || null, hw_almacenamiento: val('vf-hw-disco') || null,
      hw_ram: val('vf-hw-ram') || null, hw_estado: val('vf-hw-estado') || null, impresora_modelo: val('vf-imp-modelo') || null, impresora_interfaz: val('vf-imp-interfaz') || null,
      impresora_qr_ok: qr === '' ? null : qr === 'true', presupuesto_aceptado: (document.getElementById('vf-presupuesto') as HTMLInputElement).checked,
      fecha_go_live: val('vf-golive') || null, notas: val('vf-notas') || null, checklist };
    const r = await API.patch('verifactu_sedes', { id: `eq.${id}` }, cambios);
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    Object.assign(v, cambios);
    toast('Guardado');
    ir('verifactu');
  },
  async vfQuitar(id: string) {
    if (!confirm('Quitar esta sede del tablero VeriFactu. La sede no se toca.')) return;
    const r = await API.delete('verifactu_sedes', { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo quitar: ${r.error.message}`, 'error'); return; }
    _sedes = _sedes.filter(x => x.id !== id);
    toast('Quitada del tablero');
    ir('verifactu');
  },
});
