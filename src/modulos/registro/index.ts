// Registro de cambios (paridad bloque 6, modules/auditoria.js de la app): quién
// cambió qué y cuándo. #/registro = todo, con filtros por tabla, persona,
// texto y fecha; #/registro/<tabla>/<id> = el historial de UNA ficha (el
// enlace «Historial» de cliente, sitio, trabajo, ticket y presupuesto). Lo
// sirve la función `historial`, que junta la auditoría del hub y la de la app
// (marcadas «hub» / «app»). Solo admin. Prefijo de ids: rg-.
import type { Modulo } from '../../core/modulo';
import { registrarAcciones } from '../../core/dispatcher';
import { llamarFuncion } from '../../core/funciones';
import { equipo } from '../../core/equipo';
import { ir } from '../../core/router';
import { esc } from '../../ui/dom';

// Nombre en pantalla de cada tabla (las demás salen tal cual).
const TABLAS: Record<string, string> = {
  clientes: 'Cliente', locales: 'Sitio', contactos: 'Contacto', trabajos: 'Trabajo', tickets: 'Ticket', tareas: 'Tarea',
  presupuestos: 'Presupuesto', gastos: 'Gasto', sesiones: 'Fichaje', agenda: 'Día de agenda', contratos: 'Contrato',
  mantenimientos_programados: 'Mantenimiento', oportunidades: 'Oportunidad', catalogo: 'Artículo del catálogo',
  furgoneta_inventario: 'Producto del inventario', usuarios: 'Usuario', lista_dia: 'Lista del día',
  proyectos: 'Proyecto', comandas: 'Comanda', paginas: 'Página de la wiki', facturas: 'Factura', ticket_comentarios: 'Comentario de ticket',
};
const ACCION: Record<string, [string, string]> = { INSERT: ['Creado', 'bien'], UPDATE: ['Modificado', ''], DELETE: ['Eliminado', 'mal'] };
const OCULTOS = new Set(['id', 'created_at', 'updated_at', 'cuerpo_html', 'firma_png', 'foto_url', 'firma_cliente']);

interface Fila { id: string; ts: string; tabla: string; registro_id: string; accion: string; usuario_nombre: string | null; usuario_email: string | null;
  cambios: Record<string, [unknown, unknown]> | null; antes: Record<string, unknown> | null; despues: Record<string, unknown> | null; titulo: string | null; fuente: 'hub' | 'app' }

let _filtro: Record<string, string> = {};
let _ultimo: string | null = null;
let _ficha = false;

const nombreTabla = (t: string) => TABLAS[t] ?? t;
const etiqueta = (c: string) => c.replace(/_id$/, '').replace(/_/g, ' ');
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

function valor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '<i class="nota">vacío</i>';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.length ? esc(v.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(', ')) : '<i class="nota">vacío</i>';
  if (typeof v === 'object') return `<code>${esc(JSON.stringify(v).slice(0, 160))}</code>`;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return esc(new Date(s).toLocaleString('es-ES'));
  return esc(s.length > 200 ? s.slice(0, 200) + '…' : s);
}

function fila(r: Fila): string {
  const [txt, tono] = ACCION[r.accion] ?? [r.accion, ''];
  const quien = r.usuario_nombre || r.usuario_email || 'sistema';
  let detalle = '';
  if (r.accion === 'UPDATE' && r.cambios) {
    detalle = `<ul class="rg-cambios">${Object.entries(r.cambios).map(([k, [a, d]]) =>
      `<li><b>${esc(etiqueta(k))}</b>: <span class="rg-antes">${valor(a)}</span> → <span>${valor(d)}</span></li>`).join('')}</ul>`;
  } else {
    const f = r.accion === 'DELETE' ? r.antes : r.despues;
    const campos = f ? Object.entries(f).filter(([k, v]) => !OCULTOS.has(k) && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) : [];
    if (campos.length) detalle = `<details><summary>${campos.length} ${campos.length === 1 ? 'campo' : 'campos'}</summary><ul class="rg-cambios">${campos.map(([k, v]) => `<li><b>${esc(etiqueta(k))}</b>: ${valor(v)}</li>`).join('')}</ul></details>`;
  }
  const que = _ficha ? '' : `<span class="rg-que">${esc(nombreTabla(r.tabla))}${r.titulo ? ` · ${esc(r.titulo)}` : ''}</span>`;
  return `<li class="rg-item"><div class="rg-cab"><span class="chip ${tono}">${esc(txt)}</span>${que}
    <span class="rg-quien">${esc(quien)}</span><span class="chip" title="${r.fuente === 'app' ? 'Cambiado en la app actual' : 'Cambiado en el hub'}">${r.fuente}</span>
    <small class="nota">${esc(new Date(r.ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }))}</small></div>${detalle}</li>`;
}

async function cargar(mas = false) {
  const lista = document.getElementById('rg-lista'), btn = document.getElementById('rg-mas') as HTMLButtonElement | null;
  if (!lista || !btn) return;
  if (!mas) { _ultimo = null; lista.innerHTML = '<p class="cargando">Cargando…</p>'; }
  btn.disabled = true;
  const { data, error } = await llamarFuncion<{ filas: Fila[]; mas: boolean; app_ok: boolean }>('historial', { ..._filtro, ...(mas && _ultimo ? { antes_de: _ultimo } : {}) }, 30000);
  if (!document.getElementById('rg-lista')) return;
  btn.disabled = false;
  if (error || !data) { lista.innerHTML = `<p class="aviso mal">No se pudo leer el registro: ${esc(error)}</p>`; btn.hidden = true; return; }
  const filas = Array.isArray(data.filas) ? data.filas : [];
  const html = filas.map(fila).join('');
  const aviso = data.app_ok === false ? '<p class="aviso">No se ha podido leer el registro de la app: solo sale lo cambiado en el hub.</p>' : '';
  if (!mas) lista.innerHTML = filas.length ? `${aviso}<ul class="rg-items">${html}</ul>`
    : `${aviso}<p class="vacio">${_ficha ? 'Sin cambios registrados en esta ficha (el registro empieza el día que se activó la auditoría).' : 'Nada que coincida.'}</p>`;
  else lista.querySelector('.rg-items')?.insertAdjacentHTML('beforeend', html);
  _ultimo = filas.at(-1)?.ts ?? _ultimo;
  btn.hidden = !data.mas;
}

async function pintar(el: HTMLElement, params: string[]) {
  const [tabla, id] = params;
  _ficha = !!(tabla && id);
  _filtro = _ficha ? { tabla, registro_id: id } : {};
  const personas = _ficha ? [] : await equipo();
  el.innerHTML = `${_ficha ? `<p><a href="#" data-action="rgVolver">← Volver</a></p><h2>Historial de cambios · ${esc(nombreTabla(tabla))}</h2>` : `
    <form class="tarjeta in-campos rg-filtros" data-on-submit="rgFiltrar" data-prevent="1" data-on-change="rgFiltrar">
      <label>Qué <select id="rg-tabla"><option value="">Todo</option>${Object.entries(TABLAS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <label>Quién <select id="rg-usuario"><option value="">Cualquiera</option>${personas.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('')}</select></label>
      <label>Nombre de la ficha <input id="rg-texto" placeholder="Bar Manolo, #151…" data-on-input="rgEscribir"></label>
      <label>Desde <input id="rg-desde" type="date"></label>
    </form>`}
    <section class="tarjeta"><div id="rg-lista"></div><div class="acciones"><button class="btn secundario" id="rg-mas" data-action="rgMas" hidden>Cargar más</button></div></section>`;
  await cargar();
}

let _t = 0;
registrarAcciones({
  rgFiltrar() {
    _filtro = Object.fromEntries(Object.entries({ tabla: val('rg-tabla'), usuario_id: val('rg-usuario'), texto: val('rg-texto'), desde: val('rg-desde') }).filter(([, v]) => v));
    void cargar();
  },
  rgEscribir() { clearTimeout(_t); _t = window.setTimeout(() => (document.getElementById('rg-tabla') as HTMLElement | null)?.dispatchEvent(new Event('change', { bubbles: true })), 350); },
  rgMas: () => cargar(true),
  rgVolver() { if (history.length > 1) history.back(); else ir('registro'); },
});

export const moduloRegistro: Modulo = {
  id: 'registro',
  titulo: 'Registro de cambios',
  grupo: 'Sistema',
  icono: '🕘',
  soloAdmin: true,
  explicacion: 'Quién cambió qué y cuándo, en el hub y en la app (cada cambio dice dónde se hizo). Cada ficha de cliente, sitio, trabajo, ticket y presupuesto tiene su «Historial».',
  pintar,
};
