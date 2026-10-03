// Oportunidades (fase 4, área del hub): #/oportunidades (embudo con arrastre,
// lista, previsión y, para admins, los embudos), #/oportunidades/nueva[/<cliente>]
// y #/oportunidades/<id> (ficha: datos, etapa, actividades y lo que la app ya
// tiene vinculado: presupuestos, trabajos y tareas con esa oportunidad).
// Las que crea la app sola (formulario web, WhatsApp) llegan por sync-app.
// Prefijo de ids: op-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { esAdmin, usuario } from '../../core/estado';
import { equipo, nombreDe } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esc, toast, hace, fechaHora } from '../../ui/dom';
import { botonChatFicha } from '../../ui/chat-ficha';
import { esDelHub } from '../../core/areas';
import {
  type Oportunidad, type Pipeline, type Etapa,
  TIPOS_ACTIVIDAD, ORIGENES, eur, pipelines, buscarClientes, nombresClientes, enApp,
} from '../ventas/datos';

type Vista = 'embudo' | 'lista' | 'prevision' | 'embudos';
const CLAVE_VISTA = 'hub_oport_vista', CLAVE_PIPE = 'hub_oport_pipeline';
const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const hoy = () => new Date().toLocaleDateString('sv-SE');

let _pipes: Pipeline[] = [];
let _ops: Oportunidad[] = [];
let _nombres = new Map<string, string>();
let _arrastrando: string | null = null;
let _actual: Oportunidad | null = null;
let _verCerradas = false;

const etapaDe = (o: Oportunidad): Etapa | undefined => _pipes.find(p => p.id === o.pipeline_id)?.etapas.find(e => e.clave === o.estado);
const pipeActual = () => _pipes.find(p => p.id === leer(CLAVE_PIPE, '')) ?? _pipes[0];

function tarjeta(o: Oportunidad): string {
  const vencida = o.fecha_seguimiento && o.fecha_seguimiento < hoy() && !o.cerrada_at;
  return `<article class="pr-tarjeta" draggable="true" data-id="${esc(o.id)}" data-on-dragstart="opArrastrar:$this" data-on-dragend="opSoltarFin"
      data-action="opAbrir" data-p0="${esc(o.id)}">
    <div class="pr-tarjeta-cab"><strong>${eur(o.valor_estimado)}</strong>${o.origen ? `<span class="chip">${esc(o.origen)}</span>` : ''}</div>
    <h4>${esc(o.titulo)}</h4>
    <div class="pr-tarjeta-pie"><span>${esc(o.cliente_id ? _nombres.get(o.cliente_id) ?? '' : 'Sin cliente')}</span>
      ${o.fecha_seguimiento ? `<span class="${vencida ? 'mal' : ''}">📅 ${esc(o.fecha_seguimiento)}</span>` : ''}
      ${o.tecnico_id ? `<span>👤 ${esc(o.tecnico_id)}</span>` : ''}</div>
  </article>`;
}

function vistaEmbudo(p: Pipeline): string {
  const ops = _ops.filter(o => o.pipeline_id === p.id);
  const etapas = p.etapas.filter(e => _verCerradas || e.tipo === 'abierta');
  return `<div class="pr-kanban">${etapas.map(e => {
    const col = ops.filter(o => o.estado === e.clave).sort((a, b) => a.orden - b.orden || b.created_at.localeCompare(a.created_at));
    const suma = col.reduce((s, o) => s + Number(o.valor_estimado ?? 0), 0);
    return `<section class="pr-columna op-${e.tipo}" data-etapa="${esc(e.clave)}" data-on-dragover="opSobre:$this" data-prevent="1"
        data-on-dragleave="opFuera:$this" data-on-drop="opSoltar:${esc(e.clave)}">
      <header><h3>${esc(e.nombre)}</h3><span class="chip">${col.length}</span></header>
      <p class="nota">${eur(suma)} · ${e.probabilidad} %</p>
      <div class="pr-col-cuerpo">${col.map(tarjeta).join('') || '<p class="vacio">—</p>'}</div></section>`;
  }).join('')}</div>`;
}

function vistaLista(p: Pipeline): string {
  const ops = _ops.filter(o => o.pipeline_id === p.id && (_verCerradas || !o.cerrada_at));
  if (!ops.length) return '<p class="vacio">No hay oportunidades.</p>';
  return `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Oportunidad</th><th>Cliente</th><th>Etapa</th><th>Valor</th><th>Seguimiento</th><th>Quién</th><th>Origen</th></tr></thead>
    <tbody>${ops.map(o => `<tr class="fila-clic" data-action="opAbrir" data-p0="${esc(o.id)}"><td>${esc(o.titulo)}</td>
      <td>${esc(o.cliente_id ? _nombres.get(o.cliente_id) ?? '' : '')}</td><td>${esc(etapaDe(o)?.nombre ?? o.estado)}</td><td>${eur(o.valor_estimado)}</td>
      <td class="${o.fecha_seguimiento && o.fecha_seguimiento < hoy() && !o.cerrada_at ? 'mal' : ''}">${esc(o.fecha_seguimiento ?? '')}</td>
      <td>${esc(o.tecnico_id ?? '')}</td><td>${esc(o.origen ?? '')}</td></tr>`).join('')}</tbody></table></div>`;
}

// Previsión: valor × probabilidad de su etapa, por mes de seguimiento.
function vistaPrevision(p: Pipeline): string {
  const abiertas = _ops.filter(o => o.pipeline_id === p.id && !o.cerrada_at);
  const meses = new Map<string, { bruto: number; ponderado: number; n: number }>();
  for (const o of abiertas) {
    const mes = (o.fecha_seguimiento ?? hoy()).slice(0, 7);
    const m = meses.get(mes) ?? { bruto: 0, ponderado: 0, n: 0 };
    m.bruto += Number(o.valor_estimado ?? 0); m.ponderado += Number(o.valor_estimado ?? 0) * (etapaDe(o)?.probabilidad ?? 0) / 100; m.n++;
    meses.set(mes, m);
  }
  const filas = [...meses.entries()].sort(([a], [b]) => a.localeCompare(b));
  const ganado90 = _ops.filter(o => o.pipeline_id === p.id && etapaDe(o)?.tipo === 'ganada' && o.cerrada_at && o.cerrada_at > new Date(Date.now() - 90 * 86400000).toISOString());
  const perdido90 = _ops.filter(o => o.pipeline_id === p.id && etapaDe(o)?.tipo === 'perdida' && o.cerrada_at && o.cerrada_at > new Date(Date.now() - 90 * 86400000).toISOString());
  const tasa = ganado90.length + perdido90.length ? Math.round(ganado90.length / (ganado90.length + perdido90.length) * 100) : null;
  return `<div class="di-cifras">
    <article class="tarjeta di-cifra"><h3>En juego</h3><p class="di-valor">${eur(abiertas.reduce((s, o) => s + Number(o.valor_estimado ?? 0), 0))}</p><p class="nota">${abiertas.length} abiertas</p></article>
    <article class="tarjeta di-cifra"><h3>Previsión ponderada</h3><p class="di-valor">${eur(filas.reduce((s, [, m]) => s + m.ponderado, 0))}</p><p class="nota">valor × probabilidad de la etapa</p></article>
    <article class="tarjeta di-cifra"><h3>Ganado (90 días)</h3><p class="di-valor">${eur(ganado90.reduce((s, o) => s + Number(o.valor_estimado ?? 0), 0))}</p><p class="nota">${ganado90.length} ganadas${tasa != null ? ` · ${tasa} % de las cerradas` : ''}</p></article>
  </div>
  <div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Mes de seguimiento</th><th>Oportunidades</th><th>Valor</th><th>Ponderado</th></tr></thead>
    <tbody>${filas.map(([mes, m]) => `<tr><td class="${mes < hoy().slice(0, 7) ? 'mal' : ''}">${esc(mes)}${mes < hoy().slice(0, 7) ? ' (atrasado)' : ''}</td><td>${m.n}</td><td>${eur(m.bruto)}</td><td>${eur(m.ponderado)}</td></tr>`).join('')
      || '<tr><td colspan="4" class="vacio">Nada abierto.</td></tr>'}</tbody></table></div>`;
}

function vistaEmbudos(): string {
  if (!esAdmin()) return '<p class="aviso">Solo un administrador cambia los embudos.</p>';
  const editor = (p: Pipeline | null) => `<form class="tarjeta" data-on-submit="opGuardarPipe:$this" data-prevent="1" data-id="${esc(p?.id ?? '')}">
    <h3>${p ? esc(p.nombre) : 'Nuevo embudo'}${p?.por_defecto ? ' <span class="chip">por defecto</span>' : ''}</h3>
    <label>Nombre <input name="nombre" value="${esc(p?.nombre ?? '')}" required maxlength="80"></label>
    <label>Etapas, una por línea: <code>Nombre | probabilidad | abierta, ganada o perdida</code>
      <textarea name="etapas" rows="7" required>${esc((p?.etapas ?? [{ clave: 'Nuevo', nombre: 'Nuevo', probabilidad: 10, tipo: 'abierta' }, { clave: 'Ganado', nombre: 'Ganado', probabilidad: 100, tipo: 'ganada' }, { clave: 'Perdido', nombre: 'Perdido', probabilidad: 0, tipo: 'perdida' }])
        .map(e => `${e.nombre} | ${e.probabilidad} | ${e.tipo}`).join('\n'))}</textarea></label>
    <p class="nota">Cambiar el nombre de una etapa con oportunidades dentro las dejaría sin etapa: la base no lo deja.</p>
    <div class="acciones"><button class="btn" type="submit">Guardar</button></div></form>`;
  return `<div class="in-rejilla">${_pipes.map(editor).join('')}${editor(null)}</div>`;
}

async function pintarLista(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [pipes, ops] = await Promise.all([pipelines(), API.get<Oportunidad[]>('oportunidades', { select: '*', order: 'created_at.desc' })]);
  if (ops.error) { el.innerHTML = `<p class="aviso mal">No se pudieron leer: ${esc(ops.error.message)}</p>`; return; }
  _pipes = pipes; _ops = ops.data ?? [];
  _nombres = await nombresClientes(_ops.map(o => o.cliente_id));
  const vista = leer(CLAVE_VISTA, 'embudo') as Vista;
  const p = pipeActual();
  if (!p) { el.innerHTML = '<p class="aviso">No hay ningún embudo.</p>'; return; }
  const cuerpo = vista === 'lista' ? vistaLista(p) : vista === 'prevision' ? vistaPrevision(p) : vista === 'embudos' ? vistaEmbudos() : vistaEmbudo(p);
  el.innerHTML = `<div class="acciones pr-barra">
      <div class="segmentado" role="tablist">${(['embudo', 'lista', 'prevision', ...(esAdmin() ? ['embudos'] : [])] as Vista[]).map(v =>
        `<button role="tab" aria-selected="${v === vista}" class="${v === vista ? 'activo' : ''}" data-action="opVista" data-p0="${v}">${{ embudo: 'Embudo', lista: 'Lista', prevision: 'Previsión', embudos: 'Configurar embudos' }[v]}</button>`).join('')}</div>
      ${_pipes.length > 1 ? `<select id="op-pipe" data-on-change="opPipe:$value" aria-label="Embudo">${_pipes.map(x => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>` : ''}
      ${vista === 'embudo' || vista === 'lista' ? `<label class="check"><input type="checkbox" ${_verCerradas ? 'checked' : ''} data-on-change="opCerradas:$checked"> Ver ganadas y perdidas</label>` : ''}
      <button class="btn" data-action="opNueva">+ Nueva oportunidad</button>
    </div>${cuerpo}`;
}

// ── Nueva / ficha ──────────────────────────────────────────────────────────
async function formulario(o: Partial<Oportunidad>, nueva: boolean): Promise<string> {
  const personas = await equipo();
  const pipes = _pipes.length ? _pipes : (_pipes = await pipelines());
  const pipe = pipes.find(p => p.id === o.pipeline_id) ?? pipes[0];
  const cliente = o.cliente_id ? (await nombresClientes([o.cliente_id])).get(o.cliente_id) ?? '' : '';
  return `<form class="tarjeta" data-on-submit="${nueva ? 'opCrear' : 'opGuardar'}" data-prevent="1">
    <label>Título <input id="op-titulo" required maxlength="200" value="${esc(o.titulo ?? '')}" placeholder="p. ej. Cámaras para el hotel"></label>
    <div class="in-campos">
      <label>Cliente <input id="op-cliente-q" autocomplete="off" value="${esc(cliente)}" placeholder="Buscar…" data-on-input="opBuscarCliente:$value"></label>
      <label>Valor estimado (€) <input id="op-valor" type="number" min="0" step="1" value="${esc(o.valor_estimado ?? '')}"></label>
      <label>Seguimiento <input id="op-seguimiento" type="date" value="${esc(o.fecha_seguimiento ?? '')}"></label>
      <label>Quién la lleva <select id="op-quien"><option value="">—</option>${personas.map(p => { const n = nombreDe(p.id) || p.nombre; return `<option ${n === (o.tecnico_id ?? (nueva ? nombreDe(usuario()?.id) : '')) ? 'selected' : ''}>${esc(n)}</option>`; }).join('')}</select></label>
      <label>Origen <select id="op-origen"><option value="">—</option>${[...new Set([...ORIGENES, ...(o.origen ? [o.origen] : [])])].map(x => `<option ${x === o.origen ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      ${pipes.length > 1 ? `<label>Embudo <select id="op-pipeline">${pipes.map(p => `<option value="${esc(p.id)}" ${p.id === pipe.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>` : ''}
    </div>
    <input type="hidden" id="op-cliente" value="${esc(o.cliente_id ?? '')}"><ul id="op-cliente-res" class="resultados"></ul>
    <label>Descripción <textarea id="op-descripcion" rows="4">${esc(o.descripcion ?? '')}</textarea></label>
    <div class="acciones"><button class="btn" type="submit">${nueva ? 'Crear' : 'Guardar'}</button></div>
  </form>`;
}

async function pintarFicha(el: HTMLElement, id: string) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [{ data: o, error }, pipes] = await Promise.all([API.single<Oportunidad>('oportunidades', { select: '*', id: `eq.${id}` }), pipelines()]);
  if (error || !o) { el.innerHTML = '<p class="aviso mal">No se encontró la oportunidad.</p><p><a href="#/oportunidades">← Oportunidades</a></p>'; return; }
  _actual = o; _pipes = pipes;
  const pipe = pipes.find(p => p.id === o.pipeline_id)!;
  const [acts, pres, trab, tar] = await Promise.all([
    API.get<any[]>('actividades', { select: 'id,fecha,tipo,texto,usuario_id', oportunidad_id: `eq.${o.id}`, order: 'fecha.desc' }),
    API.get<any[]>('presupuestos', { select: 'id,numero_presupuesto,titulo,estado,total', oportunidad_id: `eq.${o.id}` }),
    API.get<any[]>('trabajos', { select: 'id,numero,titulo,estado', oportunidad_id: `eq.${o.id}` }),
    API.get<any[]>('tareas', { select: 'id,numero,titulo,estado', oportunidad_id: `eq.${o.id}` }),
  ]);
  const [, presHub] = await Promise.all([equipo(), esDelHub('presupuestos')]);
  const vinc = [...(pres.data ?? []).map(p => `📄 Presupuesto ${esc(p.numero_presupuesto ?? '')} ${esc(p.titulo ?? '')} · ${esc(p.estado)} · ${eur(p.total, 2)}`),
    ...(trab.data ?? []).map(t => `🛠 Trabajo #${t.numero} ${esc(t.titulo ?? '')} · ${esc(t.estado)}`),
    ...(tar.data ?? []).map(t => `✅ Tarea #${t.numero ?? ''} ${esc(t.titulo)} · ${esc(t.estado)}`)];
  el.innerHTML = `<p><a href="#/oportunidades">← Oportunidades</a>${o.cliente_id ? ` · <a href="#/clientes/${esc(o.cliente_id)}">Ficha del cliente</a>` : ''}</p>
    <div class="tarjeta-cab"><h2>🎯 ${esc(o.titulo)}</h2><span class="nota">Creada ${esc(hace(o.created_at))}${o.origen ? ` · entró por ${esc(o.origen)}` : ''}</span>${botonChatFicha('oportunidad', o.id, o.titulo, `#/oportunidades/${o.id}`)}
      ${presHub ? `<a class="btn secundario" href="#/presupuestos/nuevo/o/${esc(o.id)}">📄 Crear presupuesto</a>` : ''}</div>
    <div class="op-etapas" role="group" aria-label="Etapa">${pipe.etapas.map(e => `<button class="op-etapa ${e.clave === o.estado ? 'activo' : ''} op-${e.tipo}"
      data-action="opEtapa" data-p0="${esc(e.clave)}" aria-pressed="${e.clave === o.estado}">${esc(e.nombre)}</button>`).join('')}</div>
    ${o.estado === 'Perdido' || pipe.etapas.find(e => e.clave === o.estado)?.tipo === 'perdida' ? `<p class="aviso">Perdida${o.motivo_perdida ? `: ${esc(o.motivo_perdida)}` : ''}</p>` : ''}
    <div class="op-ficha">${await formulario(o, false)}
      <div>
        <section class="tarjeta"><h3>Apuntar</h3><form data-on-submit="opApuntar" data-prevent="1">
          <select id="op-act-tipo" aria-label="Tipo">${Object.entries(TIPOS_ACTIVIDAD).map(([k, t]) => `<option value="${k}" ${k === 'llamada' ? 'selected' : ''}>${t.icono} ${esc(t.nombre)}</option>`).join('')}</select>
          <textarea id="op-act-texto" rows="2" required placeholder="Qué pasó…"></textarea>
          <div class="acciones"><button class="btn" type="submit">Apuntar</button></div></form>
          <ul class="di-ultimo">${(acts.data ?? []).map(a => `<li><small class="nota" title="${esc(fechaHora(a.fecha))}">${esc(hace(a.fecha))}</small>
            <span>${TIPOS_ACTIVIDAD[a.tipo]?.icono ?? ''} ${esc(a.texto)} <small class="nota">· ${esc(nombreDe(a.usuario_id))}</small></span></li>`).join('') || '<li class="nota">Sin actividad todavía.</li>'}</ul></section>
        <section class="tarjeta"><h3>En la app</h3>${vinc.length ? `<ul>${vinc.map(v => `<li>${v}</li>`).join('')}</ul>` : '<p class="nota">Nada vinculado todavía.</p>'}
          <p class="nota">Presupuestos y trabajos se crean en la <a href="${esc(enApp())}" target="_blank" rel="noopener">app actual ↗</a> eligiendo esta oportunidad.</p></section>
        ${esAdmin() ? '<div class="acciones"><button class="btn peligro" data-action="opBorrar">Borrar oportunidad</button></div>' : ''}
      </div></div>`;
}

async function pintarNueva(el: HTMLElement, clienteId?: string) {
  _pipes = await pipelines();
  const p = pipeActual();
  el.innerHTML = `<p><a href="#/oportunidades">← Oportunidades</a></p><h2>Nueva oportunidad</h2>${await formulario({ cliente_id: clienteId ?? null, pipeline_id: p?.id }, true)}`;
}

function datosForm(): Partial<Oportunidad> {
  const v = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
  const d: Partial<Oportunidad> = {
    titulo: v('op-titulo'), cliente_id: v('op-cliente') || null, valor_estimado: v('op-valor') ? Number(v('op-valor')) : 0,
    fecha_seguimiento: v('op-seguimiento') || null, tecnico_id: v('op-quien') || null, origen: v('op-origen') || null,
    descripcion: v('op-descripcion') || null,
  };
  if (document.getElementById('op-pipeline')) d.pipeline_id = v('op-pipeline');
  return d;
}

async function mover(o: Oportunidad, clave: string) {
  const e = _pipes.find(p => p.id === o.pipeline_id)?.etapas.find(x => x.clave === clave);
  if (!e || o.estado === clave) return false;
  let motivo: string | null = null;
  if (e.tipo === 'perdida') {
    motivo = prompt('¿Por qué se ha perdido? (precio, competencia, no contesta…)') ?? null;
    if (motivo === null) return false;
  }
  const r = await API.patch('oportunidades', { id: `eq.${o.id}` }, { estado: clave, ...(e.tipo === 'perdida' ? { motivo_perdida: motivo || null } : {}) });
  if (r.error) { toast(`No se pudo mover: ${r.error.message}`, 'error'); return false; }
  toast(e.tipo === 'ganada' ? '🎉 Ganada' : `→ ${e.nombre}`);
  return true;
}

let _timerCli: number | undefined;
registrarAcciones({
  opVista(v: string) { guardar(CLAVE_VISTA, v); resolver(); },
  opPipe(id: string) { guardar(CLAVE_PIPE, id); resolver(); },
  opCerradas(v: boolean) { _verCerradas = v; resolver(); },
  opNueva() { ir('oportunidades', 'nueva'); },
  opAbrir(id: string) { ir('oportunidades', id); },
  opArrastrar(el: HTMLElement) { _arrastrando = el.dataset.id ?? null; el.classList.add('arrastrando'); },
  opSoltarFin() { _arrastrando = null; document.querySelectorAll('.arrastrando,.pr-columna.sobre').forEach(e => e.classList.remove('arrastrando', 'sobre')); },
  opSobre(el: HTMLElement) { el.classList.add('sobre'); },
  opFuera(el: HTMLElement) { el.classList.remove('sobre'); },
  async opSoltar(clave: string) {
    document.querySelectorAll('.pr-columna.sobre').forEach(e => e.classList.remove('sobre'));
    const o = _ops.find(x => x.id === _arrastrando);
    if (o && await mover(o, clave)) resolver();
  },
  async opEtapa(clave: string) { if (_actual && await mover(_actual, clave)) resolver(); },
  opBuscarCliente(q: string) {
    clearTimeout(_timerCli);
    (document.getElementById('op-cliente') as HTMLInputElement).value = '';
    _timerCli = window.setTimeout(async () => {
      const ul = document.getElementById('op-cliente-res');
      if (!ul) return;
      const cs = await buscarClientes(q);
      ul.innerHTML = cs.map(c => `<li><button type="button" class="btn secundario" data-action="opElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}
        <small class="nota">${esc(c.nif ?? '')}</small></button></li>`).join('');
    }, 250);
  },
  opElegirCliente(id: string, nombre: string) {
    (document.getElementById('op-cliente') as HTMLInputElement).value = id;
    (document.getElementById('op-cliente-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('op-cliente-res'); if (ul) ul.innerHTML = '';
  },
  async opCrear() {
    const d = datosForm();
    if (!d.titulo) return;
    const r = await API.post<Oportunidad[]>('oportunidades', { ...d, estado: _pipes.find(p => p.id === (d.pipeline_id ?? pipeActual()?.id))?.etapas[0]?.clave ?? 'Detectado',
      pipeline_id: d.pipeline_id ?? pipeActual()?.id });
    if (r.error) { toast(`No se pudo crear: ${r.error.message}`, 'error'); return; }
    toast('Oportunidad creada');
    ir('oportunidades', r.data![0].id);
  },
  async opGuardar() {
    if (!_actual) return;
    const d = datosForm();
    if (d.pipeline_id && d.pipeline_id !== _actual.pipeline_id) d.estado = _pipes.find(p => p.id === d.pipeline_id)?.etapas[0]?.clave;
    const r = await API.patch('oportunidades', { id: `eq.${_actual.id}` }, d);
    if (r.error) toast(`No se pudo guardar: ${r.error.message}`, 'error'); else { toast('Guardado'); resolver(); }
  },
  async opApuntar() {
    if (!_actual) return;
    const texto = (document.getElementById('op-act-texto') as HTMLTextAreaElement).value.trim();
    if (!texto) return;
    const r = await API.post('actividades', { tipo: (document.getElementById('op-act-tipo') as HTMLSelectElement).value, texto,
      oportunidad_id: _actual.id, cliente_id: _actual.cliente_id });
    if (r.error) toast(`No se pudo apuntar: ${r.error.message}`, 'error'); else resolver();
  },
  async opBorrar() {
    if (!_actual || !confirm(`¿Borrar «${_actual.titulo}» y sus actividades? No se puede deshacer.`)) return;
    const r = await API.delete('oportunidades', { id: `eq.${_actual.id}` });
    if (r.error) toast(`No se pudo borrar: ${r.error.message}`, 'error'); else ir('oportunidades');
  },
  async opGuardarPipe(form: HTMLFormElement) {
    const f = form;
    const nombre = (f.elements.namedItem('nombre') as HTMLInputElement).value.trim();
    const etapas: Etapa[] = (f.elements.namedItem('etapas') as HTMLTextAreaElement).value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [n, pr, t] = l.split('|').map(x => x.trim());
      const tipo = (['abierta', 'ganada', 'perdida'].includes(t) ? t : 'abierta') as Etapa['tipo'];
      return { clave: n, nombre: n, probabilidad: Math.max(0, Math.min(100, Number(pr) || 0)), tipo };
    });
    if (!nombre || etapas.length < 2 || !etapas.some(e => e.tipo === 'ganada')) { toast('Hace falta un nombre y al menos una etapa abierta y una ganada', 'error'); return; }
    const id = f.dataset.id;
    const r = id ? await API.patch('pipelines', { id: `eq.${id}` }, { nombre, etapas }) : await API.post('pipelines', { nombre, etapas, orden: _pipes.length });
    if (r.error) toast(`No se pudo guardar: ${r.error.message}`, 'error'); else { toast('Embudo guardado'); resolver(); }
  },
});

async function contador(): Promise<Contador | null> {
  const [abiertas, vencidas] = await Promise.all([
    API.contar('oportunidades', { cerrada_at: 'is.null' }),
    API.contar('oportunidades', { cerrada_at: 'is.null', fecha_seguimiento: `lt.${hoy()}` }),
  ]);
  if (abiertas == null) return null;
  return { valor: abiertas, subtitulo: vencidas ? `${vencidas} con el seguimiento vencido` : 'oportunidades abiertas', tono: vencidas ? 'aviso' : 'neutro' };
}

export const moduloOportunidades: Modulo = {
  id: 'oportunidades',
  titulo: 'Oportunidades',
  grupo: 'Clientes',
  icono: '🎯',
  explicacion: 'El embudo de ventas: cada posible venta pasa de etapa en etapa (arrastrando la tarjeta) hasta ganarse o perderse. Se llevan aquí, en el hub; las que entran solas por la web o por WhatsApp aparecen también. La previsión multiplica el valor por la probabilidad de cada etapa.',
  async pintar(el, params) {
    if (params[0] === 'nueva') await pintarNueva(el, params[1]);
    else if (params[0]) await pintarFicha(el, params[0]);
    else await pintarLista(el);
  },
  contador,
};
