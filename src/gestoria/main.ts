// Área de la gestoría (fase 10): jornada, ausencias, gastos, facturas y cierre
// del mes. Misma mecánica que el portal de clientes (enlace mágico, sesión
// propia, función `portal`), con un acceso de tipo «gestoria». Todo lo que
// consulta queda en la traza.
import '../portal/portal.css';
import { FUNCIONES_URL, SUPABASE_ANON_KEY } from '../core/config';
import { esc, fechaHora } from '../ui/dom';

const CLAVE = 'okc_gestoria_token';
const raiz = document.getElementById('gestoria')!;
const leerToken = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };
const guardarToken = (t: string | null) => { try { if (t) localStorage.setItem(CLAVE, t); else localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ } };
const eur = (n: unknown) => `${Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const hm = (m: number | null) => m == null ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const hora = (v: string | null) => v ? new Date(v).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Atlantic/Canary' }) : '—';
const mesAnterior = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString('sv-SE').slice(0, 7); };
let _mes = mesAnterior();
let _personas: { id: string; nombre: string }[] = [];
let _csv: (string | number | null)[][] = [];

async function llamar<T = any>(accion: string, cuerpo: Record<string, unknown> = {}): Promise<T> {
  const token = leerToken();
  const res = await fetch(`${FUNCIONES_URL}/portal`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, ...(token ? { 'x-portal-token': token } : {}) },
    body: JSON.stringify({ accion, mes: _mes, ...cuerpo }) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && j.sesion === false) { guardarToken(null); entrar(j.error); throw new Error(j.error); }
  if (!res.ok) throw new Error(j.error ?? 'No se pudo completar');
  return j as T;
}

function entrar(error?: string) {
  raiz.innerHTML = `<main><div class="po-tarjeta po-entrar"><h1>Gestoría</h1><p class="po-nota">Ok Computer Tenerife</p>${error ? `<p class="po-mal">${esc(error)}</p>` : ''}
    <form id="ge-entrar"><label>Tu correo <input id="ge-email" type="email" required autocomplete="email"></label><button class="po-btn" type="submit">Enviarme el enlace para entrar</button></form></div></main>`;
  document.getElementById('ge-entrar')!.addEventListener('submit', async e => {
    e.preventDefault();
    const r = await llamar<{ mensaje: string }>('pedir_enlace', { email: (document.getElementById('ge-email') as HTMLInputElement).value }).catch(err => ({ mensaje: (err as Error).message }));
    (e.target as HTMLFormElement).outerHTML = `<p>${esc(r.mensaje)}</p>`;
  });
}

const nombre = (id: string) => _personas.find(p => p.id === id)?.nombre ?? '—';
const SECCIONES: [string, string][] = [['jornada', 'Jornada'], ['ausencias', 'Ausencias'], ['gastos', 'Gastos'], ['facturas', 'Facturas emitidas'], ['cierre', 'Cierre del mes']];

async function jornada(): Promise<string> {
  const r = await llamar('g_jornada');
  const por = new Map<string, any[]>();
  for (const d of r.dias) por.set(d.usuario_id, [...(por.get(d.usuario_id) ?? []), d]);
  _csv = [['Persona', 'Día', 'Entrada', 'Salida', 'Trabajado', 'Pausas', 'Observaciones'], ...r.dias.map((d: any) => [d.nombre, d.fecha, hora(d.entrada), hora(d.salida), hm(d.trabajado_min), hm(d.pausas_min),
    [d.ausencia, d.ajustado ? `corregido: ${d.motivo_ajuste}` : ''].filter(Boolean).join(' · ')])];
  return [...por.entries()].map(([uid, dias]) => {
    const conf = r.conformidad.find((c: any) => c.usuario_id === uid);
    return `<section class="po-tarjeta po-scroll"><h2>${esc(nombre(uid) !== '—' ? nombre(uid) : dias[0].nombre)}</h2>
      <p class="po-nota">${hm(dias.reduce((a: number, d: any) => a + (d.trabajado_min ?? 0), 0))} h en ${dias.filter((d: any) => d.trabajado_min).length} días · conformidad ${conf ? `dada el ${esc(fechaHora(conf.confirmado_at))}` : 'pendiente'}</p>
      <table class="po-tabla"><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th>Trabajado</th><th class="po-ocultable">Observaciones</th></tr></thead><tbody>
      ${dias.map((d: any) => `<tr><td>${esc(d.fecha)}</td><td>${hora(d.entrada)}</td><td>${hora(d.salida)}</td><td>${hm(d.trabajado_min)}</td>
        <td class="po-ocultable">${esc(d.ausencia ?? '')}${d.ajustado ? ` <span class="po-chip aviso">corregido: ${esc(d.motivo_ajuste)}</span>` : ''}</td></tr>`).join('')}</tbody></table></section>`;
  }).join('') || '<p class="po-nota">Sin jornada registrada este mes.</p>';
}

async function ausencias(): Promise<string> {
  const as = await llamar<any[]>('g_ausencias');
  _csv = [['Persona', 'Tipo', 'Desde', 'Hasta', 'Días laborables'], ...as.map(a => [nombre(a.usuario_id), a.tipo, a.desde, a.hasta, a.dias])];
  return `<div class="po-tarjeta po-scroll">${as.length ? `<table class="po-tabla"><thead><tr><th>Persona</th><th>Tipo</th><th>Fechas</th><th>Días</th></tr></thead><tbody>
    ${as.map(a => `<tr><td>${esc(nombre(a.usuario_id))}</td><td>${esc(a.tipo)}</td><td>${esc(a.desde)} → ${esc(a.hasta)}</td><td>${a.dias}</td></tr>`).join('')}</tbody></table>` : '<p class="po-nota">Ninguna este mes.</p>'}</div>`;
}

async function gastos(): Promise<string> {
  const g = await llamar('g_gastos');
  const tot = g.tickets.reduce((a: number, t: any) => a + Number(t.total ?? 0), 0) + g.app.reduce((a: number, t: any) => a + Number(t.importe ?? 0), 0);
  _csv = [['Origen', 'Fecha', 'Proveedor', 'NIF', 'Concepto', 'Base', 'Impuesto %', 'Impuesto', 'Total', 'Categoría', 'Estado'],
    ...g.tickets.map((t: any) => ['ticket', t.fecha, t.proveedor, t.nif, t.concepto, t.base, t.impuesto_pct, t.impuesto, t.total, t.categoria, t.estado]),
    ...g.app.map((t: any) => ['app', t.fecha, '', '', t.descripcion ?? t.notas, '', '', '', t.importe, t.categoria, t.tipo])];
  return `<p class="po-tarjeta">Total del mes: <strong>${eur(tot)}</strong></p>
    <section class="po-tarjeta po-scroll"><h2>Tickets y facturas de gasto</h2>${g.tickets.length ? `<table class="po-tabla"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Base</th><th>Impuesto</th><th>Total</th><th></th></tr></thead><tbody>
      ${g.tickets.map((t: any) => `<tr><td>${esc(t.fecha)}</td><td>${esc(t.proveedor ?? '')}<br><small class="po-nota">${esc(t.nif ?? '')} · ${esc(t.categoria ?? '')}${t.estado !== 'ok' ? ' · sin confirmar' : ''}</small></td>
        <td>${t.base != null ? eur(t.base) : '—'}</td><td>${t.impuesto != null ? `${eur(t.impuesto)} (${t.impuesto_pct ?? '?'} %)` : '—'}</td><td>${eur(t.total)}</td>
        <td>${t.archivo ? `<button class="po-btn sec" data-ver="${esc(t.id)}">Ver</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="po-nota">Ninguno.</p>'}</section>
    <section class="po-tarjeta po-scroll"><h2>Gastos apuntados por los técnicos</h2>${g.app.length ? `<table class="po-tabla"><thead><tr><th>Fecha</th><th>Concepto</th><th>Importe</th></tr></thead><tbody>
      ${g.app.map((t: any) => `<tr><td>${esc(t.fecha ?? '')}</td><td>${esc(t.descripcion ?? t.notas ?? t.categoria ?? '')}${t.foto_url && /^https:\/\//.test(t.foto_url) ? ` · <a href="${esc(t.foto_url)}" target="_blank" rel="noopener">foto</a>` : ''}</td><td>${eur(t.importe)}</td></tr>`).join('')}</tbody></table>` : '<p class="po-nota">Ninguno.</p>'}</section>`;
}

async function facturas(): Promise<string> {
  const fs = await llamar<any[]>('g_facturas');
  _csv = [['Número', 'Fecha', 'Cliente', 'Total', 'Pendiente', 'Estado'], ...fs.map(f => [f.numero, f.fecha, f.cliente_nombre, f.total, f.saldo, f.estado])];
  return `<p class="po-tarjeta">${fs.length} facturas · ${eur(fs.reduce((a, f) => a + Number(f.total ?? 0), 0))} (con impuestos)</p>
    <div class="po-tarjeta po-scroll"><table class="po-tabla"><thead><tr><th>Nº</th><th>Fecha</th><th>Cliente</th><th>Total</th></tr></thead><tbody>
    ${fs.map(f => `<tr><td>${esc(f.numero)}</td><td>${esc(f.fecha)}</td><td>${esc(f.cliente_nombre ?? '')}</td><td>${eur(f.total)}</td></tr>`).join('') || '<tr><td colspan="4" class="po-nota">Ninguna.</td></tr>'}</tbody></table></div>`;
}

async function cierre(): Promise<string> {
  const c = await llamar('g_cierre');
  _csv = [];
  return `<section class="po-tarjeta"><h2>Cierre de ${esc(_mes)}</h2><p>Estado: <span class="po-chip ${c.estado === 'cerrado' ? 'bien' : c.estado === 'revisado' ? 'aviso' : ''}">${esc(c.estado)}</span></p>
    ${c.nota_gestoria ? `<p class="po-nota">Vuestra nota: «${esc(c.nota_gestoria)}»</p>` : ''}
    ${c.estado !== 'cerrado' ? `<form id="ge-cierre"><label>Nota para la empresa (lo que falta, dudas…) <textarea id="ge-nota" rows="4">${esc(c.nota_gestoria ?? '')}</textarea></label>
      <button class="po-btn" type="submit">Marcar el mes como revisado</button></form>` : '<p>La empresa ya lo ha cerrado.</p>'}</section>`;
}

async function pintar() {
  const sec = location.hash.replace(/^#\/?/, '') || 'jornada';
  document.querySelectorAll('.po-menu a').forEach(a => a.classList.toggle('activo', a.getAttribute('href') === `#/${sec}`));
  const c = document.getElementById('ge-cuerpo')!;
  c.innerHTML = '<p class="po-cargando">Cargando…</p>';
  try {
    c.innerHTML = sec === 'ausencias' ? await ausencias() : sec === 'gastos' ? await gastos() : sec === 'facturas' ? await facturas() : sec === 'cierre' ? await cierre() : await jornada();
  } catch (e) { if (leerToken()) c.innerHTML = `<p class="po-mal">${esc((e as Error).message)}</p>`; }
}

async function arrancar() {
  const codigo = new URLSearchParams(location.search).get('c');
  if (codigo) {
    history.replaceState(null, '', location.pathname + location.hash);
    try { const r = await llamar<{ token: string; tipo: string }>('entrar', { codigo }); guardarToken(r.token); }
    catch (e) { entrar((e as Error).message); return; }
  }
  if (!leerToken()) { entrar(); return; }
  let yo: any;
  try { yo = await llamar('yo'); } catch { return; }
  if (yo.tipo !== 'gestoria') { guardarToken(null); entrar('Este acceso no es de la gestoría.'); return; }
  _personas = await llamar('g_personas').catch(() => []);
  raiz.innerHTML = `<header class="po-cab"><span class="po-marca">Ok Computer Tenerife · Gestoría</span><span class="po-nota">${esc(yo.email)}</span>
      <label class="ge-mes">Mes <input type="month" id="ge-mes" value="${_mes}"></label><button class="po-btn sec" id="ge-csv">CSV</button><button class="po-btn sec" id="ge-salir">Salir</button></header>
    <nav class="po-menu" aria-label="Secciones">${SECCIONES.map(([k, t]) => `<a href="#/${k}">${t}</a>`).join('')}</nav><main id="ge-cuerpo"></main>`;
  document.getElementById('ge-mes')!.addEventListener('change', e => { _mes = (e.target as HTMLInputElement).value || _mes; pintar(); });
  document.getElementById('ge-salir')!.addEventListener('click', async () => { await llamar('salir').catch(() => {}); guardarToken(null); entrar(); });
  document.getElementById('ge-csv')!.addEventListener('click', () => {
    if (!_csv.length) return;
    const t = _csv.map(f => f.map(v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + t], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${(location.hash.replace(/^#\/?/, '') || 'jornada')}-${_mes}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
  });
  raiz.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-ver]');
    if (!b) return;
    try { const r = await llamar<{ url: string }>('g_gasto_url', { id: b.dataset.ver }); window.open(r.url, '_blank', 'noopener'); } catch (err) { alert((err as Error).message); }
  });
  raiz.addEventListener('submit', async e => {
    if ((e.target as HTMLElement).id !== 'ge-cierre') return;
    e.preventDefault();
    try { await llamar('g_cierre', { estado: 'revisado', nota: (document.getElementById('ge-nota') as HTMLTextAreaElement).value }); pintar(); } catch (err) { alert((err as Error).message); }
  });
  window.addEventListener('hashchange', pintar);
  pintar();
}
arrancar();
