// Deshacer — volver atrás del último cambio (paridad bloque 6, portado de
// ui/deshacer.js de la app). Se engancha al cliente de datos como observador
// de escrituras: antes de cada PATCH/DELETE fotografía las filas que se van a
// tocar y, si la escritura sale bien, apunta cómo desandarla. Todo lo escrito a
// raíz del MISMO gesto (un clic, un arrastre) es UNA entrada. Las mismas reglas:
//  · Solo las tablas de la lista. Fuera: el fichaje (se corrige en Personas),
//    las funciones de la base (hub.fichar, trabajo_estado…: hacen más de lo que
//    se ve) y lo que espera en la cola (aún no ha pasado: se descarta allí).
//  · Borrar una ficha entera NO se apunta (`sinBorrado`): reinsertarla no
//    devolvería lo que colgaba de ella. Sí el borrado de filas hijas.
//  · Un grupo viejo solo se deshace si nadie ha vuelto a tocar esas filas.
//  · Sin rehacer, y el historial es de la sesión (no se guarda en disco).
import { API, registrarObservadorEscrituras, type Resultado } from './api';

interface CfgTabla { et: string; sinBorrado?: boolean; sinColumnas?: string[] }
const TABLAS: Record<string, CfgTabla> = {
  trabajos: { et: 'Trabajo', sinBorrado: true }, tareas: { et: 'Tarea', sinBorrado: true }, tickets: { et: 'Ticket', sinBorrado: true },
  clientes: { et: 'Cliente', sinBorrado: true }, locales: { et: 'Sitio', sinBorrado: true }, contactos: { et: 'Contacto', sinBorrado: true },
  presupuestos: { et: 'Presupuesto', sinBorrado: true }, oportunidades: { et: 'Oportunidad', sinBorrado: true }, catalogo: { et: 'Producto', sinBorrado: true },
  tablero_notas: { et: 'Nota', sinBorrado: true }, mant_seguimiento: { et: 'Seguimiento', sinBorrado: true },
  mantenimientos_programados: { et: 'Mantenimiento', sinBorrado: true }, planes_mantenimiento: { et: 'Plan de mantenimiento', sinBorrado: true },
  plantillas_trabajo: { et: 'Plantilla', sinBorrado: true }, presupuesto_plantillas: { et: 'Plantilla', sinBorrado: true },
  checklist_plantillas: { et: 'Checklist', sinBorrado: true }, usuarios: { et: 'Usuario', sinBorrado: true }, contratos: { et: 'Contrato', sinBorrado: true },
  proyectos: { et: 'Proyecto', sinBorrado: true }, paginas: { et: 'Página', sinBorrado: true }, comandas: { et: 'Comanda', sinBorrado: true },
  // Filas hijas: aquí el borrado también se deshace.
  agenda: { et: 'Día de trabajo', sinColumnas: ['tipo'] }, lista_dia: { et: 'Lista del día' }, plan_tareas: { et: 'Tarea del plan' },
  local_hardware: { et: 'Equipo' }, local_software: { et: 'Software' }, local_camaras: { et: 'Cámara' }, local_telefonos: { et: 'Teléfono' },
  trabajo_comentarios: { et: 'Comentario' }, ticket_comentarios: { et: 'Comentario' }, checklist_respuestas: { et: 'Respuesta de checklist' },
  sitio_tarea_seguimiento: { et: 'Tarea del sitio' }, comanda_tareas: { et: 'Tarea de comanda' }, actividades: { et: 'Actividad' },
  proyecto_tareas: { et: 'Tarea del proyecto' }, proyecto_objetivos: { et: 'Objetivo' }, proyecto_hitos: { et: 'Hito' }, proyecto_vinculos: { et: 'Vínculo' },
};
const CAMPOS_TITULO = ['titulo', 'nombre', 'asunto', 'concepto', 'texto', 'descripcion'];
const MAX_GRUPOS = 20, MAX_FILAS = 200, MAX_GESTO_MS = 15000, MAX_FOTO_MS = 4000;

type Fila = Record<string, any>;
interface Entrada { clase: 'alta' | 'cambio' | 'borrado'; tabla: string; filas: { id: string; antes?: Fila; fila: Fila }[]; etiqueta: string }
export interface Grupo { id: number; gesto: number; ts: number; etiqueta: string; entradas: Entrada[] }
interface Ctx { metodo: string; tabla: string; claves?: string[]; filas?: Fila[] }

const pila: Grupo[] = [];
let _seq = 0, _gesto = 0, _deshaciendo = false;
for (const ev of ['click', 'keydown', 'submit', 'touchend', 'change', 'drop']) document.addEventListener(ev, () => { _gesto++; }, true);

const avisar = () => document.dispatchEvent(new CustomEvent('hub:deshacer', { detail: { n: pila.length } }));
const titulo = (f: Fila | undefined) => { for (const c of CAMPOS_TITULO) if (typeof f?.[c] === 'string' && f[c].trim()) return f[c].trim().slice(0, 40); return ''; };
const etiquetaDe = (clase: Entrada['clase'], tabla: string, f: Fila | undefined) =>
  `${clase === 'alta' ? 'Alta de' : clase === 'borrado' ? 'Borrado de' : 'Cambio en'} ${(TABLAS[tabla]?.et ?? tabla).toLowerCase()}${titulo(f) ? ` «${titulo(f)}»` : ''}`;

async function antes(metodo: string, tabla: string, params: Record<string, string>, body: unknown): Promise<Ctx | null> {
  if (_deshaciendo) return null;
  const cfg = TABLAS[tabla];
  if (!cfg) return null;
  if (metodo === 'POST') return { metodo, tabla };
  if (metodo === 'DELETE' && cfg.sinBorrado) return null;
  const claves = metodo === 'PATCH' ? Object.keys((body ?? {}) as object) : undefined;
  if (claves && !claves.length) return null;
  const select = claves ? [...new Set(['id', ...claves])].join(',') : '*';
  // Contra el reloj: poder deshacer no vale retrasar 10 s un guardado sin buena red.
  const r = await Promise.race([
    API._raw<Fila[]>('GET', tabla, { ...params, select, limit: String(MAX_FILAS + 1) }),
    new Promise<Resultado<Fila[]>>(ok => setTimeout(() => ok({ data: null, error: { message: 'foto lenta' } }), MAX_FOTO_MS)),
  ]);
  if (r.error || !Array.isArray(r.data) || !r.data.length || r.data.length > MAX_FILAS || r.data.some(f => !f.id)) return null;
  return { metodo, tabla, claves, filas: r.data };
}

function despues(c: unknown, res: Resultado<unknown>) {
  const ctx = c as Ctx;
  if (_deshaciendo || res.error || res.encolado) return;
  let e: Entrada;
  if (ctx.metodo === 'POST') {
    const creadas = (Array.isArray(res.data) ? res.data : [res.data]).filter((f: any) => f?.id) as Fila[];
    if (!creadas.length) return;
    e = { clase: 'alta', tabla: ctx.tabla, filas: creadas.map(f => ({ id: f.id, fila: f })), etiqueta: '' };
  } else if (ctx.metodo === 'PATCH') {
    e = { clase: 'cambio', tabla: ctx.tabla, filas: ctx.filas!.map(f => ({ id: f.id, antes: Object.fromEntries(ctx.claves!.map(k => [k, f[k] ?? null])), fila: f })), etiqueta: '' };
  } else e = { clase: 'borrado', tabla: ctx.tabla, filas: ctx.filas!.map(f => ({ id: f.id, fila: f })), etiqueta: '' };
  e.etiqueta = etiquetaDe(e.clase, e.tabla, e.filas[0].fila);
  const ahora = Date.now(), g = pila[0];
  if (g && g.gesto === _gesto && ahora - g.ts < MAX_GESTO_MS) { g.entradas.push(e); g.ts = ahora; }
  else { pila.unshift({ id: ++_seq, gesto: _gesto, ts: ahora, etiqueta: e.etiqueta, entradas: [e] }); if (pila.length > MAX_GRUPOS) pila.length = MAX_GRUPOS; }
  avisar();
}

registrarObservadorEscrituras({ antes, despues });

export const historial = () => pila;
export const hayDeshacer = () => pila.length > 0;
export function limpiarHistorial() { pila.length = 0; avisar(); }
/** Lo siguiente que se escriba será una acción nueva (lo que encadena órdenes sin tocar la pantalla). */
export function nuevaAccion() { _gesto++; }

export function bloqueadoPor(g: Grupo): Grupo | null {
  const i = pila.indexOf(g);
  const suyas = new Set(g.entradas.flatMap(e => e.filas.map(f => `${e.tabla}:${f.id}`)));
  for (let j = 0; j < i; j++) if (pila[j].entradas.some(e => e.filas.some(f => suyas.has(`${e.tabla}:${f.id}`)))) return pila[j];
  return null;
}

async function revertir(e: Entrada): Promise<string | null> {
  for (const f of [...e.filas].reverse()) {
    let r: Resultado<unknown>;
    if (e.clase === 'alta') r = await API._raw('DELETE', e.tabla, { id: `eq.${f.id}` });
    else if (e.clase === 'cambio') r = await API._raw('PATCH', e.tabla, { id: `eq.${f.id}` }, f.antes);
    else { const fila = { ...f.fila }; (TABLAS[e.tabla]?.sinColumnas ?? []).forEach(c => delete fila[c]); r = await API._raw('POST', e.tabla, {}, fila); }
    if (r.error) return r.error.message;
  }
  return null;
}

/** Deshace un grupo (el último si no se dice cuál). Devuelve el mensaje para la persona. */
export async function deshacer(id?: number): Promise<{ ok: boolean; mensaje: string }> {
  const g = id == null ? pila[0] : pila.find(x => x.id === id);
  if (!g) return { ok: false, mensaje: 'No hay nada que deshacer' };
  const choque = bloqueadoPor(g);
  if (choque) return { ok: false, mensaje: `Deshaz antes «${choque.etiqueta}»: toca lo mismo` };
  _deshaciendo = true;
  let error: string | null = null;
  try { for (const e of [...g.entradas].reverse()) { error = await revertir(e); if (error) break; } }
  finally { _deshaciendo = false; }
  if (error) { avisar(); return { ok: false, mensaje: `No se pudo deshacer del todo (${error}): míralo en su ficha` }; }
  pila.splice(pila.indexOf(g), 1);
  avisar();
  return { ok: true, mensaje: `Deshecho: ${g.etiqueta}` };
}
