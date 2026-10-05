// Mapa (fase 4): #/mapa. Las sedes con coordenadas (locales.lat/lng de la
// app) coloreadas según la capa: estado de los equipos (Breeze), estado de
// cobro (mantenimiento y, para admins, facturas vencidas de Zoho), clase A/B/C
// del cliente u oportunidades abiertas. Leaflet se carga solo al abrir esta
// pantalla. Mosaicos de OpenStreetMap, como en la app. Prefijo de ids: ma-.
// A la derecha, el planificador de la app (Día · Semana · Ruta, técnicos
// fichados): `planificador.ts`, cargado bajo demanda con Leaflet.
import type { Modulo, Contador } from '../../core/modulo';
import type * as Leaflet from 'leaflet';
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { esc } from '../../ui/dom';
import { clases, eur } from '../ventas/datos';

type Capa = 'rmm' | 'cobro' | 'clase' | 'oportunidades';
interface Sede { id: string; nombre: string; cliente_id: string | null; lat: number; lng: number; direccion: string | null; estado_pago: string | null; plan: string | null }
type Planificador = typeof import('./planificador');
interface Punto { color: string; radio: number; texto: string; valor: number }

const CLAVE = 'hub_mapa_capa';
const CENTRO: [number, number] = [28.29, -16.55];
const leer = () => { try { return (localStorage.getItem(CLAVE) as Capa) ?? 'rmm'; } catch { return 'rmm'; } };
const guardar = (v: string) => { try { localStorage.setItem(CLAVE, v); } catch { /* sin almacenamiento */ } };
const color = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888';

let _mapa: Leaflet.Map | null = null;
let _grupo: Leaflet.LayerGroup | null = null;
let _L: typeof Leaflet | null = null;
let _sedes: Sede[] = [];
let _marcas = new Map<string, Leaflet.CircleMarker>();
let _plan: Planificador | null = null;
let _datos: { rmm: Map<string, any>; clase: Map<string, string>; vencido: Map<string, number>; opor: Map<string, { n: number; valor: number }>; clientes: Map<string, string> } | null = null;

async function cargarDatos() {
  const [ls, rmm, cs, ops, cli] = await Promise.all([
    API.fetchAll<Sede>('locales', { select: 'id,nombre,cliente_id,lat,lng,direccion,estado_pago,plan', activo: 'neq.false', lat: 'not.is.null', lng: 'not.is.null' }),
    API.get<any[]>('rmm_estado_local', { select: '*' }),
    clases(),
    API.get<any[]>('oportunidades', { select: 'cliente_id,valor_estimado', cerrada_at: 'is.null', cliente_id: 'not.is.null' }),
    API.fetchAll<any>('clientes', { select: 'id,nombre,zoho_id', activo: 'eq.true' }),
  ]);
  _sedes = (ls.data ?? []).filter(s => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)));
  const opor = new Map<string, { n: number; valor: number }>();
  for (const o of ops.data ?? []) { const m = opor.get(o.cliente_id) ?? { n: 0, valor: 0 }; m.n++; m.valor += Number(o.valor_estimado ?? 0); opor.set(o.cliente_id, m); }
  const vencido = new Map<string, number>();
  if (esAdmin()) {
    const hoy = new Date().toLocaleDateString('sv-SE');
    const { data } = await API.get<any[]>('zoho_facturas', { select: 'cliente_zoho_id,saldo', saldo: 'gt.0', vence: `lt.${hoy}`, estado: 'not.in.(void,draft,paid)' });
    const porZoho = new Map((cli.data ?? []).filter(c => c.zoho_id).map(c => [c.zoho_id, c.id]));
    for (const f of data ?? []) { const id = porZoho.get(f.cliente_zoho_id); if (id) vencido.set(id, (vencido.get(id) ?? 0) + Number(f.saldo)); }
  }
  _datos = { rmm: new Map((rmm.data ?? []).map(e => [e.local_id, e])), clase: new Map([...cs.values()].map(c => [c.cliente_id, c.clase])),
    vencido, opor, clientes: new Map((cli.data ?? []).map(c => [c.id, c.nombre])) };
}

const LEYENDAS: Record<Capa, [string, string][]> = {
  rmm: [['--bien', 'Todo bien'], ['--aviso', 'Alguno sin conexión'], ['--mal', 'Con alertas o caída'], ['--texto-suave', 'Sin agente']],
  cobro: [['--bien', 'Al corriente'], ['--aviso', 'Pendiente o último aviso'], ['--mal', 'No paga o facturas vencidas'], ['--texto-suave', 'Sin mantenimiento']],
  clase: [['--serie-1', 'Clase A (grande)'], ['--serie-2', 'Clase B'], ['--texto-suave', 'Clase C']],
  oportunidades: [['--primario', 'Con oportunidades abiertas (tamaño = valor)'], ['--texto-suave', 'Sin oportunidades']],
};

function punto(s: Sede, capa: Capa): Punto {
  const d = _datos!;
  const cli = s.cliente_id ?? '';
  if (capa === 'rmm') {
    const e = d.rmm.get(s.id);
    if (!e) return { color: '--texto-suave', radio: 4, texto: 'Sin agente de Breeze', valor: 0 };
    return { color: e.estado === 'ok' ? '--bien' : e.estado === 'parcial' ? '--aviso' : '--mal', radio: 7,
      texto: `${e.conectados}/${e.equipos} equipos conectados${e.alertas ? ` · ${e.alertas} alerta(s)` : ''}`, valor: 2 };
  }
  if (capa === 'cobro') {
    const v = d.vencido.get(cli) ?? 0;
    const ep = s.estado_pago;
    if (v > 0 || ep === 'No paga') return { color: '--mal', radio: 8, texto: [ep, v ? `${eur(v, 2)} vencido en Zoho` : ''].filter(Boolean).join(' · '), valor: 3 };
    if (ep === 'Pendiente de pago' || ep === 'Último aviso') return { color: '--aviso', radio: 7, texto: ep, valor: 2 };
    if (s.plan) return { color: '--bien', radio: 6, texto: `${s.plan} · al corriente`, valor: 1 };
    return { color: '--texto-suave', radio: 4, texto: 'Sin mantenimiento', valor: 0 };
  }
  if (capa === 'clase') {
    const c = d.clase.get(cli) ?? 'C';
    return { color: c === 'A' ? '--serie-1' : c === 'B' ? '--serie-2' : '--texto-suave', radio: c === 'A' ? 9 : c === 'B' ? 7 : 4, texto: `Clase ${c}`, valor: c === 'A' ? 2 : c === 'B' ? 1 : 0 };
  }
  const o = d.opor.get(cli);
  if (!o) return { color: '--texto-suave', radio: 4, texto: 'Sin oportunidades abiertas', valor: 0 };
  return { color: '--primario', radio: Math.min(16, 6 + Math.sqrt(o.valor) / 12), texto: `${o.n} oportunidad(es) · ${eur(o.valor)}`, valor: 1 };
}

function pintarCapa(capa: Capa) {
  if (!_mapa || !_L || !_datos) return;
  _grupo?.remove();
  _grupo = _L.layerGroup().addTo(_mapa);
  _marcas = new Map();
  // Lo importante se pinta encima; una sede con trabajo ese día lleva el borde de acción.
  const conPunto = _sedes.map(s => ({ s, p: punto(s, capa) })).sort((a, b) => a.p.valor - b.p.valor);
  for (const { s, p } of conPunto) {
    const cli = s.cliente_id ? _datos.clientes.get(s.cliente_id) : null;
    const hoy = _plan?.tieneTrabajo(s.id) ?? false;
    const m = _L.circleMarker([Number(s.lat), Number(s.lng)], { radius: p.radio + (hoy ? 2 : 0), color: color(hoy ? '--accion' : '--superficie'), weight: hoy ? 3 : 2, fillColor: color(p.color), fillOpacity: 0.9 })
      .bindPopup(`<strong>${esc(s.nombre)}</strong>${cli ? `<br>${esc(cli)}` : ''}<br>${esc(p.texto)}
        <br>${s.cliente_id ? `<a href="#/clientes/${esc(s.cliente_id)}">Ficha del cliente</a> · ` : ''}<a href="#/monitorizacion/sede/${esc(s.id)}">Equipos</a>${_plan?.extraPopup(s) ?? ''}`, { maxWidth: 320 })
      .addTo(_grupo);
    _marcas.set(s.id, m);
  }
  const ley = document.getElementById('ma-leyenda');
  if (ley) ley.innerHTML = LEYENDAS[capa].map(([c, t]) => `<span><i style="background:var(${c})"></i>${esc(t)} (${conPunto.filter(x => x.p.color === c).length})</span>`).join('');
}

async function pintar(el: HTMLElement) {
  const capa = leer();
  const capas: [Capa, string][] = [['rmm', 'Equipos'], ['cobro', 'Cobro'], ['clase', 'Clase A/B/C'], ['oportunidades', 'Oportunidades']];
  el.innerHTML = `<div class="acciones mo-barra"><div class="segmentado" role="tablist">${capas.map(([k, n]) =>
      `<button role="tab" aria-selected="${k === capa}" class="${k === capa ? 'activo' : ''}" data-action="maCapa" data-p0="${k}">${n}</button>`).join('')}</div>
      <span class="nota" id="ma-cuenta"></span></div>
    <div class="ma-caja"><div class="ma-rejilla"><div><div id="ma-mapa" class="ma-mapa" role="region" aria-label="Mapa de sedes"></div>
      <div id="ma-leyenda" class="di-leyenda ma-leyenda"></div></div>
      <aside id="map-panel" class="tarjeta map-panel" aria-label="Planificador"><p class="cargando">Cargando…</p></aside></div></div>
    ${!esAdmin() ? '<p class="nota">En la capa «Cobro» solo ves el estado del mantenimiento; las facturas vencidas las ven los administradores.</p>' : ''}`;
  const [mod, plan] = await Promise.all([import('leaflet'), import('./planificador'), import('leaflet/dist/leaflet.css'), cargarDatos()]);
  _plan = plan;
  _L = (mod as any).default ?? mod;
  const caja = document.getElementById('ma-mapa');
  if (!caja || !_L) return;
  _mapa?.remove();
  _mapa = _L.map(caja, { zoomControl: true }).setView(CENTRO, 10);
  _L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>', maxZoom: 19 }).addTo(_mapa);
  const cuenta = document.getElementById('ma-cuenta');
  if (cuenta) cuenta.textContent = `${_sedes.length} sedes con ubicación`;
  pintarCapa(capa);
  const mapa = _mapa;
  await plan.iniciarPanel({ L: _L, mapa, sedes: _sedes, clientes: _datos?.clientes ?? new Map(),
    centrar(id) {
      const m = _marcas.get(id);
      if (!m || _mapa !== mapa) return false;
      mapa.setView(m.getLatLng(), Math.max(mapa.getZoom(), 15), { animate: true });
      m.openPopup();
      return true;
    },
    repintar: () => { if (_mapa === mapa) pintarCapa(leer()); } });
}

registrarAcciones({
  maCapa(k: string) {
    guardar(k);
    document.querySelectorAll('[data-action="maCapa"]').forEach(b => { b.classList.toggle('activo', (b as HTMLElement).dataset.p0 === k); b.setAttribute('aria-selected', String((b as HTMLElement).dataset.p0 === k)); });
    pintarCapa(k as Capa);
  },
});

export const moduloMapa: Modulo = {
  id: 'mapa',
  titulo: 'Mapa',
  grupo: 'Clientes',
  icono: '🗺',
  explicacion: 'Las sedes de los clientes en el mapa. Cambia de capa para ver dónde hay equipos con problemas, dónde se debe dinero, dónde están los clientes grandes o dónde hay ventas en marcha. A la derecha, el día (técnicos fichados, trabajos y tickets), la semana para planificar arrastrando y la ruta del día con los kilómetros.',
  pintar,
  async contador(): Promise<Contador | null> {
    const n = await API.contar('locales', { activo: 'neq.false', lat: 'not.is.null' });
    return n == null ? null : { valor: n, subtitulo: 'sedes en el mapa', tono: 'neutro' };
  },
};
