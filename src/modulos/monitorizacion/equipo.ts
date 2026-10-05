// Ficha de un equipo monitorizado: #/monitorizacion/equipo/<id>/<pestaña>.
// Pestañas: Resumen · Métricas (48 h) · Parches · Software · Alertas ·
// Acciones (comandos y scripts por breeze-api) · Remoto (enlaces a Breeze).
// Prefijo de ids: me-.
import { API } from '../../core/api';
import { ir, resolver } from '../../core/router';
import { registrarAcciones } from '../../core/dispatcher';
import { esc, toast, hace, fechaHora } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { tablaAlertas } from './lista';
import {
  type Equipo, type Metrica, type Script,
  equipo as leerEquipo, metricas, listarAlertas, listarScripts, nombresLocales, pedirABreeze, estadoBreeze, enBreeze,
} from './datos';

const PESTANAS = [
  ['resumen', 'Resumen'], ['metricas', 'Métricas'], ['parches', 'Parches'], ['software', 'Software'],
  ['alertas', 'Alertas'], ['acciones', 'Comandos y scripts'], ['remoto', 'Remoto'],
] as const;

let _e: Equipo | null = null;
let _swFiltro = '';
const _series = new Map<string, { t: number[]; v: number[] }>();

const dato = (k: string, v: unknown) => `<div class="me-dato"><dt>${esc(k)}</dt><dd>${v == null || v === '' ? '—' : esc(v)}</dd></div>`;
const chip = (t: string, tono = 'neutro') => `<span class="chip ${tono}">${esc(t)}</span>`;
const si = (b: boolean | null) => (b == null ? '—' : b ? 'Sí' : 'No');
function duracion(seg: number | null): string {
  if (seg == null) return '—';
  const d = Math.floor(seg / 86400), h = Math.floor((seg % 86400) / 3600);
  return d ? `${d} d ${h} h` : `${h} h ${Math.floor((seg % 3600) / 60)} min`;
}

// ── Resumen ─────────────────────────────────────────────────────────────────
async function tabResumen(e: Equipo): Promise<string> {
  const sede = e.local_id ? (await nombresLocales([e.local_id])).get(e.local_id) : null;
  const discos = (e.discos ?? []).map(d => {
    const tono = d.uso >= 90 ? 'mal' : d.uso >= 80 ? 'aviso' : 'bien';
    return `<div class="me-disco"><div class="me-disco-cab"><strong>${esc(d.unidad)}</strong>
      <span>${esc(d.libre_gb)} GB libres de ${esc(d.total_gb)} GB</span></div>
      <div class="me-barra" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(d.uso)}" aria-label="Uso de ${esc(d.unidad)}">
        <span class="${tono}" style="width:${Math.min(100, Math.max(0, d.uso))}%"></span></div>
      <small class="nota">${Math.round(d.uso)} % usado</small></div>`;
  }).join('');
  return `<div class="me-grid">
    <section class="tarjeta"><h3>Equipo</h3><dl class="me-datos">
      ${dato('Sede', sede ?? (e.sitio ? `${e.sitio} (sin sede)` : null))}
      ${dato('Cliente en Breeze', e.organizacion)}
      ${dato('Último usuario', e.ultimo_usuario)}
      ${dato('Encendido desde hace', duracion(e.encendido_seg))}
      ${dato('Reinicio pendiente', si(e.reinicio_pendiente))}
      ${dato('IP local', e.ip_local)}
      ${dato('IP pública', e.ip_publica)}
      ${dato('Alta en Breeze', fechaHora(e.alta))}
      ${dato('Agente', e.version_agente)}
    </dl></section>
    <section class="tarjeta"><h3>Hardware y sistema</h3><dl class="me-datos">
      ${dato('Sistema', `${e.so_version ?? e.so}${e.so_build ? ` (${e.so_build})` : ''}`)}
      ${dato('Fabricante / modelo', [e.fabricante, e.modelo].filter(Boolean).join(' · '))}
      ${dato('Nº de serie', e.serie)}
      ${dato('Procesador', e.cpu ? `${e.cpu}${e.nucleos ? ` · ${e.nucleos} núcleos` : ''}` : null)}
      ${dato('Memoria', e.ram_mb ? `${Math.round(e.ram_mb / 1024)} GB` : null)}
      ${dato('Virtual', si(e.virtual))}
    </dl></section>
    <section class="tarjeta"><h3>Seguridad</h3><dl class="me-datos">
      ${dato('Antivirus', e.antivirus?.replace(/_/g, ' '))}
      ${dato('Protección en tiempo real', si(e.av_tiempo_real))}
      ${dato('Cortafuegos', si(e.firewall))}
      ${dato('Cifrado de disco', e.cifrado)}
      ${dato('Amenazas', e.amenazas)}
      ${dato('Parches pendientes', e.parches_pendientes)}
    </dl></section>
    <section class="tarjeta"><h3>TPV</h3><dl class="me-datos">
      ${dato('Programa (según la sede)', e.programa_tpv)}
      ${dato('Versión instalada', e.programa_tpv ? e.tpv_version ?? 'No encontrado en el software del equipo' : null)}
    </dl></section>
    <section class="tarjeta me-ancho"><h3>Discos</h3>${discos || '<p class="vacio">Sin datos de disco.</p>'}</section>
  </div>`;
}

// ── Métricas: tres gráficas pequeñas (una serie cada una, 0-100 %) ─────────
const ANCHO = 600, ALTO = 120;
function grafica(clave: string, titulo: string, filas: Metrica[], campo: 'cpu' | 'ram' | 'disco'): string {
  const puntos = filas.filter(f => f[campo] != null);
  if (puntos.length < 2) return `<section class="tarjeta"><h3>${esc(titulo)}</h3><p class="vacio">Sin datos en las últimas 48 h.</p></section>`;
  const t = puntos.map(f => new Date(f.momento).getTime());
  const v = puntos.map(f => Number(f[campo]));
  _series.set(clave, { t, v });
  const t0 = t[0], t1 = t[t.length - 1] || t0 + 1;
  const x = (ms: number) => ((ms - t0) / (t1 - t0 || 1)) * ANCHO;
  const y = (p: number) => ALTO - (Math.min(100, Math.max(0, p)) / 100) * ALTO;
  const d = t.map((ms, i) => `${i ? 'L' : 'M'}${x(ms).toFixed(1)},${y(v[i]).toFixed(1)}`).join('');
  const media = v.reduce((a, b) => a + b, 0) / v.length;
  const max = Math.max(...v);
  return `<section class="tarjeta">
    <div class="tarjeta-cab"><h3>${esc(titulo)}</h3>
      <span class="nota">Ahora <strong>${Math.round(v[v.length - 1])} %</strong> · media ${Math.round(media)} % · máx ${Math.round(max)} %</span></div>
    <div class="me-graf" data-clave="${esc(clave)}" data-on-pointermove="meGrafHover:$this,$event" data-on-pointerout="meGrafFuera:$this,$event">
      <svg viewBox="0 0 ${ANCHO} ${ALTO}" preserveAspectRatio="none" role="img" aria-label="${esc(titulo)} en las últimas 48 horas">
        <line class="me-rejilla" x1="0" x2="${ANCHO}" y1="${y(50)}" y2="${y(50)}"/>
        <line class="me-rejilla" x1="0" x2="${ANCHO}" y1="${y(100) + 1}" y2="${y(100) + 1}"/>
        <line class="me-base" x1="0" x2="${ANCHO}" y1="${ALTO - 1}" y2="${ALTO - 1}"/>
        <path class="me-linea" d="${d}" vector-effect="non-scaling-stroke"/>
        <line class="me-cursor" x1="0" x2="0" y1="0" y2="${ALTO}" vector-effect="non-scaling-stroke" hidden/>
      </svg>
      <span class="me-eje-y" style="top:0">100 %</span><span class="me-eje-y" style="top:50%">50 %</span>
      <div class="me-punto-hover" hidden></div>
      <div class="me-tip" role="status" hidden></div>
    </div>
    <div class="me-eje"><span>${esc(fechaHora(new Date(t0).toISOString()))}</span><span>ahora</span></div>
  </section>`;
}

async function tabMetricas(e: Equipo): Promise<string> {
  const { data, error } = await metricas(e.id);
  if (error) return `<p class="aviso mal">No se pudieron leer las métricas: ${esc(error.message)}</p>`;
  const filas = data ?? [];
  return `<p class="nota">Últimas 48 horas, un punto por minuto (lo que manda el agente de Breeze). Pasa el ratón por encima para ver el valor.</p>
    <div class="me-graficas">${grafica(`cpu-${e.id}`, 'Procesador', filas, 'cpu')}${grafica(`ram-${e.id}`, 'Memoria', filas, 'ram')}${grafica(`disco-${e.id}`, 'Disco', filas, 'disco')}</div>`;
}

// ── Parches, software, alertas ─────────────────────────────────────────────
async function tabParches(e: Equipo): Promise<string> {
  const { data, error } = await API.get('rmm_parches', { select: '*', device_id: `eq.${e.id}`, order: 'estado,publicado.desc.nullslast' });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  if (!data?.length) return '<p class="vacio">Breeze no ha informado de parches para este equipo.</p>';
  const tono: Record<string, string> = { pending: 'aviso', missing: 'aviso', failed: 'mal', installed: 'bien', skipped: 'neutro' };
  const texto: Record<string, string> = { pending: 'Pendiente', missing: 'Falta', failed: 'Falló', installed: 'Instalado', skipped: 'Omitido' };
  return `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Estado</th><th>Parche</th><th>Gravedad</th><th>Publicado</th><th>Reinicio</th></tr></thead>
    <tbody>${data.map(p => `<tr><td>${chip(texto[p.estado] ?? p.estado, tono[p.estado])}</td>
      <td>${esc(p.titulo)}${p.referencia ? ` <small class="nota">${esc(p.referencia)}</small>` : ''}${p.ultimo_error ? `<br><small class="mal">${esc(p.ultimo_error)}</small>` : ''}</td>
      <td>${esc(p.severidad ?? '')}</td><td>${esc(p.publicado ?? '')}</td><td>${p.pide_reinicio ? 'Sí' : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

async function tabSoftware(e: Equipo): Promise<string> {
  const { data, error } = await API.get('rmm_software', { select: 'nombre,version,fabricante,instalado', device_id: `eq.${e.id}`, order: 'nombre' });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  const q = _swFiltro.toLowerCase();
  const lista = (data ?? []).filter(s => !q || `${s.nombre} ${s.fabricante ?? ''}`.toLowerCase().includes(q));
  return `<div class="acciones mo-barra"><input id="me-sw-filtro" type="search" placeholder="Buscar programa…" value="${esc(_swFiltro)}"
      data-on-input="meSwFiltro:$value" aria-label="Buscar programa"><span class="nota">${lista.length} de ${data?.length ?? 0}</span></div>
    <div id="me-sw-tabla" class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Programa</th><th>Versión</th><th>Fabricante</th><th>Instalado</th></tr></thead>
    <tbody>${lista.map(s => `<tr><td>${esc(s.nombre)}</td><td>${esc(s.version ?? '')}</td><td>${esc(s.fabricante ?? '')}</td><td>${esc(s.instalado ?? '')}</td></tr>`).join('')
      || '<tr><td colspan="4" class="vacio">Nada.</td></tr>'}</tbody></table></div>`;
}

async function tabAlertas(e: Equipo): Promise<string> {
  const { data, error } = await listarAlertas({ device_id: `eq.${e.id}` });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  return tablaAlertas(data ?? [], await nombresLocales([e.local_id ?? '']));
}

// ── Comandos y scripts ─────────────────────────────────────────────────────
let _scripts: Script[] = [];
async function tabAcciones(e: Equipo): Promise<string> {
  const [estado, sc, cmd, ej] = await Promise.all([
    estadoBreeze(), listarScripts(),
    API.get('rmm_comandos', { select: '*', device_id: `eq.${e.id}`, order: 'pedido.desc', limit: '15' }),
    API.get('rmm_scripts_ejecuciones', { select: '*', device_id: `eq.${e.id}`, order: 'pedido.desc', limit: '15' }),
  ]);
  _scripts = (sc.data ?? []).filter(s => !s.sistemas?.length || s.sistemas.includes(e.so));
  const apagado = !estado?.configurado;
  const comandos = Object.entries(estado?.comandos ?? { refresh_inventory: 'Refrescar inventario', reboot: 'Reiniciar', shutdown: 'Apagar', wake: 'Encender (Wake-on-LAN)' });
  return `${apagado ? '<p class="aviso">Falta el usuario de servicio del hub en Breeze: los botones están apagados hasta que se ponga.</p>' : ''}
    <div class="me-grid">
    <section class="tarjeta"><h3>Comandos</h3>
      <p class="nota">${e.conectado ? 'El equipo está conectado: le llega al momento.' : 'El equipo no está conectado: Breeze lo guarda y se lo manda cuando vuelva (salvo «Encender», que va por la red del cliente).'}</p>
      <div class="acciones">${comandos.map(([k, n]) => `<button class="btn ${k === 'shutdown' || k === 'reboot' ? 'peligro' : 'secundario'}" ${apagado ? 'disabled' : ''}
        data-action="meComando" data-p0="${esc(k)}" data-p1="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    </section>
    <section class="tarjeta"><h3>Lanzar un script</h3>
      <label for="me-script">Script</label>
      <select id="me-script" data-on-change="meScriptElegido:$value" ${apagado ? 'disabled' : ''}>
        <option value="">— Elige uno (${_scripts.length}) —</option>
        ${_scripts.map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}${s.categoria ? ` · ${esc(s.categoria)}` : ''}</option>`).join('')}
      </select>
      <p id="me-script-desc" class="nota"></p>
      <label for="me-script-params">Parámetros (JSON, si los pide)</label>
      <textarea id="me-script-params" rows="3" placeholder="{}" ${apagado ? 'disabled' : ''}></textarea>
      <div class="acciones"><button class="btn" data-action="meScript" ${apagado ? 'disabled' : ''}>Lanzar en ${esc(e.nombre)}</button></div>
    </section></div>
    <h3>Scripts recientes <button class="btn secundario" data-action="meRecargar">Actualizar</button></h3>
    ${(ej.data ?? []).length ? `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Cuándo</th><th>Script</th><th>Estado</th><th>Salida</th></tr></thead>
      <tbody>${(ej.data ?? []).map(x => `<tr><td>${esc(fechaHora(x.pedido))}</td><td>${esc(x.script ?? '')}</td>
        <td>${esc(x.estado)}${x.codigo_salida != null ? ` <small>(código ${esc(x.codigo_salida)})</small>` : ''}</td>
        <td>${x.salida || x.errores || x.error ? `<details><summary>Ver</summary><pre class="me-salida">${esc([x.salida, x.errores, x.error].filter(Boolean).join('\n--\n'))}</pre></details>` : ''}
          <a href="${esc(enBreeze.ejecucion(e.id, x.id))}" target="_blank" rel="noopener">Breeze ${ico('externo')}</a></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vacio">Ninguno en los últimos 30 días.</p>'}
    <h3>Comandos recientes</h3>
    ${(cmd.data ?? []).length ? `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Cuándo</th><th>Comando</th><th>Estado</th><th>Quién</th></tr></thead>
      <tbody>${(cmd.data ?? []).map(c => `<tr><td>${esc(fechaHora(c.pedido))}</td><td>${esc(c.tipo)}</td><td>${esc(c.estado)}</td><td>${esc(c.usuario ?? '')}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vacio">Ninguno en los últimos 30 días.</p>'}`;
}

function tabRemoto(e: Equipo): string {
  return `<div class="me-grid">
    <section class="tarjeta"><h3>Desde Breeze</h3>
      <p class="nota">El control remoto se abre en el panel de Breeze con tu propio usuario (el del hub no tiene permiso de acceso remoto, a propósito).</p>
      <div class="acciones">
        <a class="btn" href="${esc(enBreeze.equipo(e.id))}" target="_blank" rel="noopener">Abrir el equipo en Breeze ${ico('externo')}</a>
        <a class="btn secundario" href="${esc(enBreeze.terminal(e.id))}" target="_blank" rel="noopener">Terminal ${ico('externo')}</a>
        <a class="btn secundario" href="${esc(enBreeze.archivos(e.id))}" target="_blank" rel="noopener">Archivos ${ico('externo')}</a>
      </div>
      <p class="nota">Escritorio remoto: en la ficha del equipo en Breeze, botón «Connect Desktop» (abre el visor de Breeze).</p>
    </section>
    <section class="tarjeta"><h3>RustDesk</h3>
      ${e.rustdesk_id ? `<p>ID de RustDesk: <strong>${esc(e.rustdesk_id)}</strong></p>
        <a class="btn secundario" href="rustdesk://${esc(e.rustdesk_id)}">Abrir en RustDesk</a>`
        : '<p class="nota">Este equipo no tiene el campo «rustdesk_id» puesto en Breeze.</p>'}
    </section>
    <section class="tarjeta me-ancho"><h3>Sesiones remotas (90 días)</h3><div id="me-sesiones"><p class="cargando">Cargando…</p></div></section>
  </div>`;
}

async function sesiones(e: Equipo) {
  const { data } = await API.get('rmm_sesiones_remotas', { select: '*', device_id: `eq.${e.id}`, order: 'inicio.desc.nullslast', limit: '20' });
  const el = document.getElementById('me-sesiones');
  if (!el) return;
  el.innerHTML = (data ?? []).length ? `<table class="tabla"><thead><tr><th>Cuándo</th><th>Tipo</th><th>Quién</th><th>Duración</th></tr></thead>
    <tbody>${(data ?? []).map(s => `<tr><td>${esc(fechaHora(s.inicio))}</td><td>${esc({ terminal: 'Terminal', desktop: 'Escritorio', file_transfer: 'Archivos' }[s.tipo as string] ?? s.tipo)}</td>
      <td>${esc(s.usuario ?? '')}</td><td>${s.duracion_seg ? `${Math.round(s.duracion_seg / 60)} min` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="vacio">Ninguna.</p>';
}

// ── Pintar ─────────────────────────────────────────────────────────────────
export async function pintarEquipo(el: HTMLElement, id: string, pestana = 'resumen') {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const { data, error } = await leerEquipo(id);
  if (error || !data) { el.innerHTML = `<p class="aviso mal">No se encontró el equipo${error ? `: ${esc(error.message)}` : ''}.</p><p><a href="#/monitorizacion/equipos">← Equipos</a></p>`; return; }
  _e = data;
  const p = PESTANAS.some(([k]) => k === pestana) ? pestana : 'resumen';
  el.innerHTML = `<p><a href="#/monitorizacion/equipos">← Equipos</a>${data.local_id ? ` · <a href="#/monitorizacion/sede/${esc(data.local_id)}">Su sede</a>` : ''}</p>
    <div class="tarjeta-cab"><h2>${ico('monitor')} ${esc(data.nombre)}</h2>
      <span>${data.conectado ? chip('Conectado', 'bien') : chip(`Sin conexión · ${hace(data.visto_ultimo)}`, 'mal')}
      ${data.alertas_abiertas ? chip(`${data.alertas_abiertas} alerta(s)`, 'mal') : ''}${data.reinicio_pendiente ? chip('Reinicio pendiente', 'aviso') : ''}</span></div>
    <nav class="pestanas" role="tablist">${PESTANAS.map(([k, n]) =>
      `<button role="tab" aria-selected="${k === p}" class="${k === p ? 'activo' : ''}" data-action="mePestana" data-p0="${esc(id)}" data-p1="${k}">${n}</button>`).join('')}</nav>
    <div id="me-cuerpo"><p class="cargando">Cargando…</p></div>`;
  const cuerpo = p === 'remoto' ? tabRemoto(data)
    : await ({ resumen: tabResumen, metricas: tabMetricas, parches: tabParches, software: tabSoftware, alertas: tabAlertas, acciones: tabAcciones }[p]!)(data);
  const c = document.getElementById('me-cuerpo');
  if (c && _e?.id === id) c.innerHTML = cuerpo;
  if (p === 'remoto') void sesiones(data);
}

let _timerSw: number | undefined;
registrarAcciones({
  mePestana(id: string, p: string) { ir('monitorizacion', 'equipo', id, p); },
  meRecargar() { resolver(); },
  meSwFiltro(v: string) {
    _swFiltro = v;
    clearTimeout(_timerSw);
    _timerSw = window.setTimeout(async () => {
      if (!_e) return;
      const c = document.getElementById('me-cuerpo');
      if (!c) return;
      c.innerHTML = await tabSoftware(_e);
      const f = document.getElementById('me-sw-filtro') as HTMLInputElement | null;
      f?.focus(); f?.setSelectionRange(v.length, v.length);
    }, 250);
  },
  meScriptElegido(id: string) {
    const s = _scripts.find(x => x.id === id);
    const d = document.getElementById('me-script-desc');
    if (d) d.textContent = s ? [s.descripcion, s.lenguaje].filter(Boolean).join(' · ') : '';
  },
  async meComando(tipo: string, nombre: string) {
    if (!_e) return;
    const serio = tipo === 'reboot' || tipo === 'shutdown';
    if (serio && !confirm(`¿${nombre} «${_e.nombre}»? Si el cliente lo está usando, se le corta lo que esté haciendo.`)) return;
    const r = await pedirABreeze<{ entrega?: string }>({ accion: 'comando', device_id: _e.id, tipo });
    if (r.error) { toast(`Breeze no lo aceptó: ${r.error}`, 'error'); return; }
    toast(r.data?.entrega === 'queued_offline' ? `${nombre}: en cola hasta que el equipo se conecte` : `${nombre}: enviado`);
    resolver();
  },
  async meScript() {
    if (!_e) return;
    const id = (document.getElementById('me-script') as HTMLSelectElement | null)?.value;
    const s = _scripts.find(x => x.id === id);
    if (!s) { toast('Elige un script', 'error'); return; }
    const txt = (document.getElementById('me-script-params') as HTMLTextAreaElement | null)?.value.trim() || '{}';
    let parametros: Record<string, unknown>;
    try { parametros = JSON.parse(txt); } catch { toast('Los parámetros no son JSON válido', 'error'); return; }
    if (!confirm(`¿Lanzar «${s.nombre}» en «${_e.nombre}»?`)) return;
    const r = await pedirABreeze<{ equipos?: { admitido: boolean; motivo: string | null }[] }>({ accion: 'script', script_id: s.id, device_ids: [_e.id], parametros });
    if (r.error) { toast(`Breeze no lo aceptó: ${r.error}`, 'error'); return; }
    const t = r.data?.equipos?.[0];
    toast(t && !t.admitido ? `Breeze no lo admitió: ${t.motivo ?? 'sin motivo'}` : 'Script lanzado: el resultado sale en «Scripts recientes»', t && !t.admitido ? 'error' : 'info');
    resolver();
  },
  meGrafHover(caja: HTMLElement, ev: PointerEvent) {
    const s = _series.get(caja.dataset.clave ?? '');
    if (!s) return;
    const r = caja.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const objetivo = s.t[0] + f * (s.t[s.t.length - 1] - s.t[0]);
    let i = 0;
    for (let k = 1; k < s.t.length; k++) if (Math.abs(s.t[k] - objetivo) < Math.abs(s.t[i] - objetivo)) i = k;
    const px = ((s.t[i] - s.t[0]) / (s.t[s.t.length - 1] - s.t[0] || 1)) * r.width;
    const py = r.height - (Math.min(100, Math.max(0, s.v[i])) / 100) * r.height;
    const cursor = caja.querySelector<SVGLineElement>('.me-cursor');
    const punto = caja.querySelector<HTMLElement>('.me-punto-hover');
    const tip = caja.querySelector<HTMLElement>('.me-tip');
    if (!cursor || !punto || !tip) return;
    const xs = String((px / r.width) * ANCHO);
    cursor.setAttribute('x1', xs); cursor.setAttribute('x2', xs); cursor.removeAttribute('hidden');
    punto.hidden = false; punto.style.left = `${px}px`; punto.style.top = `${py}px`;
    tip.hidden = false;
    tip.innerHTML = `<strong>${Math.round(s.v[i])} %</strong> · ${esc(new Date(s.t[i]).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}`;
    tip.style.left = `${Math.min(Math.max(px, 70), r.width - 70)}px`;
  },
  meGrafFuera(caja: HTMLElement, ev: PointerEvent) {
    if (ev.relatedTarget instanceof Node && caja.contains(ev.relatedTarget)) return;
    caja.querySelector('.me-cursor')?.setAttribute('hidden', '');
    caja.querySelectorAll<HTMLElement>('.me-punto-hover,.me-tip').forEach(x => { x.hidden = true; });
  },
});
