// Oportunidades (fase 4, área del hub): #/oportunidades (embudo con arrastre,
// lista, previsión y, para admins, los embudos), #/oportunidades/nueva[/<cliente>]
// y #/oportunidades/<id> (ficha: datos, etapa, actividades y lo que la app ya
// tiene vinculado: presupuestos, trabajos y tareas con esa oportunidad).
// Las que crea la app sola (formulario web, WhatsApp) llegan por sync-app.
// Ideas de Bitrix24 (2026-10-04): barra de etapas en flechas, zonas de cierre
// al arrastrar, alta rápida por columna, «sin próximo paso» y reglas por etapa
// (el próximo paso lo pone la base; presupuesto, trabajo o comanda se
// PROPONEN y los confirma una persona: 20261025_embudo_reglas.sql).
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
import { llamarFuncion } from '../../core/funciones';
import { esqueleto } from '../../ui/esqueleto';
import {
  type Oportunidad, type Pipeline, type Etapa, type Propuesta,
  TIPOS_ACTIVIDAD, ICONO_EVENTO, ORIGENES, eur, pipelines, buscarClientes, nombresClientes, enApp,
} from '../ventas/datos';

type Vista = 'embudo' | 'lista' | 'prevision' | 'embudos';
const CLAVE_VISTA = 'hub_oport_vista', CLAVE_PIPE = 'hub_oport_pipeline';
const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const hoy = () => new Date().toLocaleDateString('sv-SE');
const enDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const PROPUESTAS: Record<Propuesta, string> = { presupuesto: 'Preparar el presupuesto', trabajo: 'Crear el trabajo', comanda: 'Encargar una comanda al equipo' };

let _pipes: Pipeline[] = [];
let _ops: Oportunidad[] = [];
let _nombres = new Map<string, string>();
let _arrastrando: string | null = null;
let _actual: Oportunidad | null = null;
let _verCerradas = false;

const etapaDe = (o: Oportunidad): Etapa | undefined => _pipes.find(p => p.id === o.pipeline_id)?.etapas.find(e => e.clave === o.estado);
const pipeActual = () => _pipes.find(p => p.id === leer(CLAVE_PIPE, '')) ?? _pipes[0];

// El próximo paso de la tarjeta: sin fecha, aviso (toda abierta necesita el siguiente).
function paso(o: Oportunidad): string {
  if (o.cerrada_at) return '';
  if (!o.fecha_seguimiento) return '<span class="op-paso falta">⚠ Sin próximo paso</span>';
  return `<span class="op-paso ${o.fecha_seguimiento < hoy() ? 'mal' : ''}">➡️ ${esc(o.fecha_seguimiento)}${o.siguiente_texto ? ` · ${esc(o.siguiente_texto)}` : ''}</span>`;
}

function tarjeta(o: Oportunidad): string {
  return `<article class="pr-tarjeta" draggable="true" data-id="${esc(o.id)}" data-on-dragstart="opArrastrar:$this" data-on-dragend="opSoltarFin"
      data-action="opAbrir" data-p0="${esc(o.id)}">
    <div class="pr-tarjeta-cab"><strong>${eur(o.valor_estimado)}</strong>${o.origen ? `<span class="chip">${esc(o.origen)}</span>` : ''}</div>
    <h4>${esc(o.titulo)}</h4>
    <div class="pr-tarjeta-pie"><span>${esc(o.cliente_id ? _nombres.get(o.cliente_id) ?? '' : 'Sin cliente')}</span>
      ${o.tecnico_id ? `<span>👤 ${esc(o.tecnico_id)}</span>` : ''}</div>
    ${paso(o)}
  </article>`;
}

const altaRapida = (e: Etapa) => `<details class="op-rapida"><summary>+ Alta rápida</summary>
  <form data-on-submit="opRapida:$this" data-prevent="1" data-etapa="${esc(e.clave)}">
    <input name="titulo" required maxlength="200" placeholder="Qué se vende" aria-label="Título de la oportunidad en ${esc(e.nombre)}">
    <input name="valor" type="number" min="0" step="1" placeholder="Valor (€)" aria-label="Valor estimado (€)">
    <div class="acciones"><button class="btn" type="submit">Crear</button></div></form></details>`;

function vistaEmbudo(p: Pipeline): string {
  const ops = _ops.filter(o => o.pipeline_id === p.id);
  const etapas = p.etapas.filter(e => _verCerradas || e.tipo === 'abierta');
  const cierres = p.etapas.filter(e => e.tipo !== 'abierta');
  // Con las cerradas escondidas, al arrastrar se cierra soltando en estas zonas.
  const zonas = _verCerradas || !cierres.length ? '' : `<div class="op-cierre" role="group" aria-label="Cerrar arrastrando"><span>Suelta aquí para cerrar:</span>
    ${cierres.map(e => `<div class="op-zona op-${e.tipo}" data-etapa="${esc(e.clave)}" data-on-dragover="opSobre:$this" data-prevent="1"
      data-on-dragleave="opFuera:$this" data-on-drop="opSoltar:${esc(e.clave)}">${e.tipo === 'ganada' ? '🎉' : '✖'} ${esc(e.nombre)}</div>`).join('')}</div>`;
  return `<div class="pr-kanban">${etapas.map(e => {
    const col = ops.filter(o => o.estado === e.clave).sort((a, b) => a.orden - b.orden || b.created_at.localeCompare(a.created_at));
    const suma = col.reduce((s, o) => s + Number(o.valor_estimado ?? 0), 0);
    const sin = e.tipo === 'abierta' ? col.filter(o => !o.fecha_seguimiento).length : 0;
    return `<section class="pr-columna op-${e.tipo}" data-etapa="${esc(e.clave)}" data-on-dragover="opSobre:$this" data-prevent="1"
        data-on-dragleave="opFuera:$this" data-on-drop="opSoltar:${esc(e.clave)}">
      <header><h3>${esc(e.nombre)}</h3><span class="chip">${col.length}</span></header>
      <p class="nota">${eur(suma)} · ${e.probabilidad} %${sin ? ` · <span class="atento">${sin} sin próximo paso</span>` : ''}</p>
      ${e.tipo === 'abierta' ? altaRapida(e) : ''}
      <div class="pr-col-cuerpo">${col.map(tarjeta).join('') || '<p class="vacio col-vacia">—</p>'}</div></section>`;
  }).join('')}</div>${zonas}`;
}

function vistaLista(p: Pipeline): string {
  const ops = _ops.filter(o => o.pipeline_id === p.id && (_verCerradas || !o.cerrada_at));
  if (!ops.length) return '<p class="vacio">No hay oportunidades.</p>';
  return `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Oportunidad</th><th>Cliente</th><th>Etapa</th><th>Valor</th><th>Próximo paso</th><th>Quién</th><th>Origen</th></tr></thead>
    <tbody>${ops.map(o => `<tr class="fila-clic" data-action="opAbrir" data-p0="${esc(o.id)}"><td>${esc(o.titulo)}</td>
      <td>${esc(o.cliente_id ? _nombres.get(o.cliente_id) ?? '' : '')}</td><td>${esc(etapaDe(o)?.nombre ?? o.estado)}</td><td>${eur(o.valor_estimado)}</td>
      <td>${o.cerrada_at ? esc(o.fecha_seguimiento ?? '') : paso(o)}</td>
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

// Reglas al entrar en cada etapa (una fila por etapa guardada; se emparejan por clave al guardar).
function reglas(p: Pipeline): string {
  const opt = (v: string, t: string, sel: boolean) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  return `<details class="op-reglas" ${p.etapas.some(e => e.seguimiento_dias != null || e.proponer) ? 'open' : ''}><summary>Reglas al entrar en cada etapa</summary>
    <div class="mo-scroll"><table class="tabla"><thead><tr><th>Etapa</th><th>Próximo paso en (días)</th><th>Qué</th><th>Proponer</th><th>Texto de la comanda</th></tr></thead>
    <tbody>${p.etapas.map(e => {
      const abierta = e.tipo === 'abierta';
      return `<tr data-clave="${esc(e.clave)}"><td>${esc(e.nombre)}</td>
        <td>${abierta ? `<input name="dias" type="number" min="0" max="365" step="1" value="${esc(e.seguimiento_dias ?? '')}" aria-label="Días hasta el próximo paso al entrar en ${esc(e.nombre)}">` : '—'}</td>
        <td>${abierta ? `<input name="texto" maxlength="120" value="${esc(e.seguimiento_texto ?? '')}" aria-label="Qué toca al entrar en ${esc(e.nombre)}">` : '—'}</td>
        <td><select name="proponer" aria-label="Qué proponer al entrar en ${esc(e.nombre)}">${opt('', '—', !e.proponer)}${(Object.keys(PROPUESTAS) as Propuesta[]).map(k => opt(k, PROPUESTAS[k], e.proponer === k)).join('')}</select></td>
        <td><input name="comanda" maxlength="200" value="${esc(e.comanda_texto ?? '')}" placeholder="{cliente}, {titulo}, {valor}" aria-label="Texto de la comanda de ${esc(e.nombre)}"></td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="nota">El próximo paso lo pone la base al entrar en la etapa (salvo que el mismo cambio traiga ya su fecha). Lo de «Proponer» se pregunta al entrar:
      nunca se hace solo y nada sale hacia el cliente. La comanda reparte tareas al equipo y avisa por Telegram.</p></details>`;
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
    ${p ? reglas(p) : ''}
    <div class="acciones"><button class="btn" type="submit">Guardar</button></div></form>`;
  return `<div class="in-rejilla">${_pipes.map(editor).join('')}${editor(null)}</div>`;
}

async function pintarLista(el: HTMLElement) {
  const v0 = leer(CLAVE_VISTA, 'embudo');
  el.innerHTML = esqueleto(v0 === 'embudo' ? 'kanban' : v0 === 'embudos' ? 'lineas' : 'tabla');
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
      ${nueva ? `<label>Próximo paso (cuándo) <input id="op-seguimiento" type="date" value="${esc(o.fecha_seguimiento ?? '')}"></label>
      <label>Próximo paso (qué) <input id="op-siguiente" maxlength="300" value="${esc(o.siguiente_texto ?? '')}" placeholder="Si se deja vacío, el de la etapa"></label>` : ''}
      <label>Quién la lleva <select id="op-quien"><option value="">—</option>${personas.map(p => { const n = nombreDe(p.id) || p.nombre; return `<option ${n === (o.tecnico_id ?? (nueva ? nombreDe(usuario()?.id) : '')) ? 'selected' : ''}>${esc(n)}</option>`; }).join('')}</select></label>
      <label>Origen <select id="op-origen"><option value="">—</option>${[...new Set([...ORIGENES, ...(o.origen ? [o.origen] : [])])].map(x => `<option ${x === o.origen ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      ${pipes.length > 1 ? `<label>Embudo <select id="op-pipeline">${pipes.map(p => `<option value="${esc(p.id)}" ${p.id === pipe.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>` : ''}
    </div>
    <input type="hidden" id="op-cliente" value="${esc(o.cliente_id ?? '')}"><ul id="op-cliente-res" class="resultados"></ul>
    <label>Descripción <textarea id="op-descripcion" rows="4">${esc(o.descripcion ?? '')}</textarea></label>
    <div class="acciones"><button class="btn" type="submit">${nueva ? 'Crear' : 'Guardar'}</button></div>
  </form>`;
}

// La barra de etapas (Bitrix24): las abiertas en flechas, con lo recorrido
// marcado, y aparte los cierres.
function barraEtapas(pipe: Pipeline, o: Oportunidad): string {
  const abiertas = pipe.etapas.filter(e => e.tipo === 'abierta'), cierres = pipe.etapas.filter(e => e.tipo !== 'abierta');
  const tipo = pipe.etapas.find(e => e.clave === o.estado)?.tipo;
  const idx = abiertas.findIndex(e => e.clave === o.estado);
  const boton = (e: Etapa, extra: string, txt: string) => `<button class="op-etapa op-${e.tipo} ${e.clave === o.estado ? 'activo' : ''} ${extra}"
    data-action="opEtapa" data-p0="${esc(e.clave)}" aria-pressed="${e.clave === o.estado}" title="${esc(e.nombre)} · ${e.probabilidad} %">${txt}</button>`;
  return `<div class="op-etapas" role="group" aria-label="Etapa">
    <div class="op-flechas">${abiertas.map((e, i) => boton(e, tipo === 'ganada' || (idx >= 0 && i < idx) ? 'hecha' : '', esc(e.nombre))).join('')}</div>
    <div class="op-cierres">${cierres.map(e => boton(e, '', `${e.tipo === 'ganada' ? '🎉' : '✖'} ${esc(e.nombre)}`)).join('')}</div></div>`;
}

function proximoPaso(o: Oportunidad): string {
  if (o.cerrada_at) return '';
  const vencido = o.fecha_seguimiento && o.fecha_seguimiento < hoy();
  return `<section class="tarjeta"><h3>➡️ Próximo paso</h3>
    ${!o.fecha_seguimiento ? '<p class="aviso">Sin próximo paso: toda oportunidad abierta necesita el siguiente. Ponle cuándo y qué.</p>'
      : vencido ? `<p class="aviso g-mal">Tocaba el ${esc(o.fecha_seguimiento)}.</p>` : ''}
    <form data-on-submit="opPaso" data-prevent="1">
      <div class="in-campos"><label>Cuándo <input id="op-paso-fecha" type="date" value="${esc(o.fecha_seguimiento ?? '')}"></label>
        <label>Qué <input id="op-paso-texto" maxlength="300" value="${esc(o.siguiente_texto ?? '')}" placeholder="p. ej. Llamar para ver si le llegó la propuesta"></label></div>
      <div class="acciones">${[[1, 'Mañana'], [3, 'En 3 días'], [7, 'En una semana']].map(([n, t]) =>
        `<button type="button" class="chip-boton" data-action="opPasoEn" data-p0="${n}">${t}</button>`).join('')}
        <button class="btn" type="submit">Guardar</button>
        ${o.fecha_seguimiento ? '<button type="button" class="btn secundario" data-action="opPasoHecho">Hecho ✓</button>' : ''}</div></form></section>`;
}

async function pintarFicha(el: HTMLElement, id: string) {
  el.innerHTML = esqueleto('ficha');
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
    ${barraEtapas(pipe, o)}
    ${o.estado === 'Perdido' || pipe.etapas.find(e => e.clave === o.estado)?.tipo === 'perdida' ? `<p class="aviso">Perdida${o.motivo_perdida ? `: ${esc(o.motivo_perdida)}` : ''}</p>` : ''}
    <div class="op-ficha">${await formulario(o, false)}
      <div>
        ${proximoPaso(o)}
        <section class="tarjeta"><h3>Apuntar</h3><form data-on-submit="opApuntar" data-prevent="1">
          <select id="op-act-tipo" aria-label="Tipo">${Object.entries(TIPOS_ACTIVIDAD).map(([k, t]) => `<option value="${k}" ${k === 'llamada' ? 'selected' : ''}>${t.icono} ${esc(t.nombre)}</option>`).join('')}</select>
          <textarea id="op-act-texto" rows="2" required placeholder="Qué pasó…"></textarea>
          <div class="acciones"><button class="btn" type="submit">Apuntar</button></div></form>
          <ul class="di-ultimo">${(acts.data ?? []).map(a => `<li><small class="nota" title="${esc(fechaHora(a.fecha))}">${esc(hace(a.fecha))}</small>
            <span>${TIPOS_ACTIVIDAD[a.tipo]?.icono ?? ICONO_EVENTO[`actividad_${a.tipo}`] ?? ''} ${esc(a.texto)} <small class="nota">· ${esc(nombreDe(a.usuario_id))}</small></span></li>`).join('') || '<li class="nota">Sin actividad todavía.</li>'}</ul></section>
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
    tecnico_id: v('op-quien') || null, origen: v('op-origen') || null, descripcion: v('op-descripcion') || null,
  };
  if (document.getElementById('op-seguimiento')) d.fecha_seguimiento = v('op-seguimiento') || null;
  if (document.getElementById('op-siguiente')) d.siguiente_texto = v('op-siguiente') || null;
  if (document.getElementById('op-pipeline')) d.pipeline_id = v('op-pipeline');
  return d;
}

// Al nacer en una etapa, su regla pone el próximo paso si no se ha dado (al
// CAMBIAR de etapa lo hace la base).
function conRegla(d: Partial<Oportunidad>, e: Etapa | undefined): Partial<Oportunidad> {
  if (!e || d.fecha_seguimiento || e.seguimiento_dias == null) return d;
  return { ...d, fecha_seguimiento: enDias(e.seguimiento_dias), siguiente_texto: d.siguiente_texto || e.seguimiento_texto || null };
}

// Lo que la etapa PROPONE al entrar. Nada se hace sin que una persona diga que
// sí, y nada sale hacia el cliente. Devuelve true si se ha ido a otra pantalla.
async function proponer(o: Oportunidad, e: Etapa): Promise<boolean> {
  if (e.proponer === 'presupuesto' || e.proponer === 'trabajo') {
    const area = e.proponer === 'presupuesto' ? 'presupuestos' : 'trabajos';
    if (!(await esDelHub(area))) { toast(`Siguiente: ${PROPUESTAS[e.proponer].toLowerCase()} (todavía en la app)`); return false; }
    if (!confirm(`«${o.titulo}» pasa a ${e.nombre}. ¿${PROPUESTAS[e.proponer]} ahora?`)) return false;
    ir(area, 'nuevo', 'o', o.id);
    return true;
  }
  if (e.proponer === 'comanda') {
    const cliente = o.cliente_id ? _nombres.get(o.cliente_id) ?? (await nombresClientes([o.cliente_id])).get(o.cliente_id) ?? '' : '';
    const base = (e.comanda_texto || 'Preparar lo vendido a {cliente}: {titulo}')
      .replace(/\{titulo\}/g, o.titulo).replace(/\{cliente\}/g, cliente || 'el cliente').replace(/\{valor\}/g, eur(o.valor_estimado));
    const texto = prompt('¿Se lo encargamos al equipo? Es una comanda: se reparte en tareas y se avisa por Telegram (al cliente no le llega nada). Cambia el texto si hace falta.', base);
    if (!texto?.trim()) return false;
    const r = await llamarFuncion<{ tareas: unknown[] }>('comandas', { accion: 'crear', texto: texto.trim() }, 120000);
    if (r.error || !r.data) toast(`No se pudo encargar: ${r.error}`, 'error');
    else toast(`Comanda repartida en ${r.data.tareas?.length ?? 0} tarea(s)`);
  }
  return false;
}

// true = hay que repintar (se ha movido y seguimos en la misma pantalla).
async function mover(o: Oportunidad, clave: string): Promise<boolean> {
  const e = _pipes.find(p => p.id === o.pipeline_id)?.etapas.find(x => x.clave === clave);
  if (!e || o.estado === clave) return false;
  let motivo: string | null = null;
  if (e.tipo === 'perdida') {
    motivo = prompt('¿Por qué se ha perdido? (precio, competencia, no contesta…)') ?? null;
    if (motivo === null) return false;
  }
  const r = await API.patch('oportunidades', { id: `eq.${o.id}` }, { estado: clave, ...(e.tipo === 'perdida' ? { motivo_perdida: motivo || null } : {}) });
  if (r.error) { toast(`No se pudo mover: ${r.error.message}`, 'error'); return false; }
  toast(e.tipo === 'ganada' ? '🎉 Ganada' : `→ ${e.nombre}${e.tipo === 'abierta' && e.seguimiento_dias != null ? ` · próximo paso en ${e.seguimiento_dias} día(s)` : ''}`);
  return !(await proponer(o, e));
}

let _timerCli: number | undefined;
registrarAcciones({
  opVista(v: string) { guardar(CLAVE_VISTA, v); resolver(); },
  opPipe(id: string) { guardar(CLAVE_PIPE, id); resolver(); },
  opCerradas(v: boolean) { _verCerradas = v; resolver(); },
  opNueva() { ir('oportunidades', 'nueva'); },
  opAbrir(id: string) { ir('oportunidades', id); },
  opArrastrar(el: HTMLElement) {
    _arrastrando = el.dataset.id ?? null; el.classList.add('arrastrando');
    // Las zonas de cierre se resaltan; en el siguiente cuadro, para no tocar el DOM en pleno dragstart.
    requestAnimationFrame(() => { if (_arrastrando) document.body.classList.add('op-arrastrando'); });
  },
  opSoltarFin() {
    _arrastrando = null; document.body.classList.remove('op-arrastrando');
    document.querySelectorAll('.arrastrando,.sobre').forEach(e => e.classList.remove('arrastrando', 'sobre'));
  },
  opSobre(el: HTMLElement) { el.classList.add('sobre'); },
  opFuera(el: HTMLElement) { el.classList.remove('sobre'); },
  async opSoltar(clave: string) {
    document.querySelectorAll('.sobre').forEach(e => e.classList.remove('sobre'));
    document.body.classList.remove('op-arrastrando');
    const o = _ops.find(x => x.id === _arrastrando);
    if (o && await mover(o, clave)) resolver();
  },
  async opEtapa(clave: string) { if (_actual && await mover(_actual, clave)) resolver(); },
  async opRapida(form: HTMLFormElement) {
    const p = pipeActual();
    const e = p?.etapas.find(x => x.clave === form.dataset.etapa);
    const titulo = (form.elements.namedItem('titulo') as HTMLInputElement).value.trim();
    const valor = Number((form.elements.namedItem('valor') as HTMLInputElement).value) || 0;
    if (!p || !e || !titulo) return;
    await equipo(); // nombreDe necesita el equipo cargado
    const r = await API.post('oportunidades', conRegla({ titulo, valor_estimado: valor, estado: e.clave, pipeline_id: p.id, tecnico_id: nombreDe(usuario()?.id) || null }, e));
    if (r.error) { toast(`No se pudo crear: ${r.error.message}`, 'error'); return; }
    toast(`Oportunidad creada en ${e.nombre}`);
    resolver();
  },
  opPasoEn(n: string) { (document.getElementById('op-paso-fecha') as HTMLInputElement).value = enDias(Number(n) || 1); },
  async opPaso() {
    if (!_actual) return;
    const fecha = (document.getElementById('op-paso-fecha') as HTMLInputElement).value || null;
    const texto = (document.getElementById('op-paso-texto') as HTMLInputElement).value.trim() || null;
    const r = await API.patch('oportunidades', { id: `eq.${_actual.id}` }, { fecha_seguimiento: fecha, siguiente_texto: texto });
    if (r.error) toast(`No se pudo guardar: ${r.error.message}`, 'error'); else { toast('Próximo paso guardado'); resolver(); }
  },
  // Hecho: queda en la línea de tiempo y la oportunidad pide el siguiente.
  async opPasoHecho() {
    if (!_actual) return;
    const a = await API.post('actividades', { tipo: 'nota', texto: `Hecho: ${_actual.siguiente_texto || 'el próximo paso'}`,
      oportunidad_id: _actual.id, cliente_id: _actual.cliente_id });
    if (a.error) { toast(`No se pudo apuntar: ${a.error.message}`, 'error'); return; }
    const r = await API.patch('oportunidades', { id: `eq.${_actual.id}` }, { fecha_seguimiento: null, siguiente_texto: null });
    if (r.error) toast(`No se pudo guardar: ${r.error.message}`, 'error'); else { toast('Hecho ✓ — ¿cuál es el siguiente?'); resolver(); }
  },
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
    const primera = _pipes.find(p => p.id === (d.pipeline_id ?? pipeActual()?.id))?.etapas[0];
    const r = await API.post<Oportunidad[]>('oportunidades', { ...conRegla(d, primera), estado: primera?.clave ?? 'Detectado',
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
    // Reglas: las de la tabla, por clave; una etapa sin fila (recién escrita) conserva las que tuviera.
    const previas = new Map((_pipes.find(x => x.id === id)?.etapas ?? []).map(e => [e.clave, e]));
    const filas = new Map([...f.querySelectorAll<HTMLTableRowElement>('tr[data-clave]')].map(tr => {
      const g = (n: string) => (tr.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value.trim() ?? '';
      return [tr.dataset.clave!, { dias: g('dias'), texto: g('texto'), proponer: g('proponer'), comanda: g('comanda') }];
    }));
    for (const e of etapas) {
      const r = filas.get(e.clave);
      if (!r) {
        const pv = previas.get(e.clave);
        if (pv) Object.assign(e, { seguimiento_dias: pv.seguimiento_dias, seguimiento_texto: pv.seguimiento_texto, proponer: pv.proponer, comanda_texto: pv.comanda_texto });
      } else {
        if (e.tipo === 'abierta' && r.dias !== '') {
          e.seguimiento_dias = Math.max(0, Math.min(365, Math.round(Number(r.dias) || 0)));
          if (r.texto) e.seguimiento_texto = r.texto;
        }
        if (r.proponer in PROPUESTAS) e.proponer = r.proponer as Propuesta;
        if (e.proponer === 'comanda' && r.comanda) e.comanda_texto = r.comanda;
      }
      for (const k of ['seguimiento_dias', 'seguimiento_texto', 'proponer', 'comanda_texto'] as const) if (e[k] == null) delete e[k];
    }
    const r = id ? await API.patch('pipelines', { id: `eq.${id}` }, { nombre, etapas }) : await API.post('pipelines', { nombre, etapas, orden: _pipes.length });
    if (r.error) toast(`No se pudo guardar: ${r.error.message}`, 'error'); else { toast('Embudo guardado'); resolver(); }
  },
});

async function contador(): Promise<Contador | null> {
  const [abiertas, vencidas, sinPaso] = await Promise.all([
    API.contar('oportunidades', { cerrada_at: 'is.null' }),
    API.contar('oportunidades', { cerrada_at: 'is.null', fecha_seguimiento: `lt.${hoy()}` }),
    API.contar('oportunidades', { cerrada_at: 'is.null', fecha_seguimiento: 'is.null' }),
  ]);
  if (abiertas == null) return null;
  const partes = [vencidas ? `${vencidas} con el seguimiento vencido` : '', sinPaso ? `${sinPaso} sin próximo paso` : ''].filter(Boolean);
  return { valor: abiertas, subtitulo: partes.join(' · ') || 'oportunidades abiertas', tono: partes.length ? 'aviso' : 'neutro' };
}

export const moduloOportunidades: Modulo = {
  id: 'oportunidades',
  titulo: 'Oportunidades',
  grupo: 'Clientes',
  icono: '🎯',
  explicacion: 'El embudo de ventas: cada posible venta pasa de etapa en etapa (arrastrando la tarjeta) hasta ganarse o perderse; al arrastrar salen abajo las zonas para cerrarla. Toda oportunidad abierta lleva su próximo paso (cuándo y qué) y cada etapa puede ponerlo sola y proponer el presupuesto, el trabajo o una comanda. Se llevan aquí, en el hub; las que entran solas por la web o por WhatsApp aparecen también. La previsión multiplica el valor por la probabilidad de cada etapa.',
  async pintar(el, params) {
    if (params[0] === 'nueva') await pintarNueva(el, params[1]);
    else if (params[0]) await pintarFicha(el, params[0]);
    else await pintarLista(el);
  },
  contador,
};
