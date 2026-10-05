// Ficha del ticket, lo que trae la paridad del bloque 8 (tanda 1, tickets.js
// de la app): tareas del ticket, duplicarlo, pasarlo a trabajo y guardar la
// resolución en la wiki. Prefijo de ids: tkx-.
//   · Tareas: las de la app (hub.tareas.ticket_id, área `tareas`); se ven ya y
//     se crean con el corte (RLS + esDelHub), como en la app: título, estado,
//     técnico y una nota.
//   · Duplicar: los mismos datos, Abierto, sin resolución ni trabajo (las
//     tareas y la conversación no se copian), como duplicarTicket.
//   · A trabajo: abre el alta de trabajo rellena (borrador) y, al crearlo, el
//     ticket queda enlazado y cerrado («Pasó a trabajo»), como
//     convertirTicketATrabajo. Con el área `trabajos` de la app no sale.
//   · Resolución a la wiki (decisión de Fran, 2026-10-05): una página por
//     ticket colgada de «Resoluciones» (hub.paginas.ticket_id); guardarla
//     otra vez la actualiza. Se reindexa para que la encuentre el buscador.
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast, hace } from '../../ui/dom';
import { dejarBorrador } from '../../ui/borrador';
import { ico } from '../../shell/linea';
import type { Ticket } from './datos';

interface Tarea { id: string; titulo: string; estado: string; tecnico_id: string | null; notas: string | null; created_at: string }
const ESTADOS_TAREA: Record<string, string> = { pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada', archivada: 'Archivada' };
const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value ?? '').trim();

let _t: Ticket | null = null;
let _cliente: string | null = null;

/** La sección «Tareas» de la ficha. `escribe` = el área `tareas` es del hub. */
export async function seccionTareas(t: Ticket, personas: { nombre: string }[], escribe: boolean): Promise<string> {
  _t = t;
  const { data } = await API.get<Tarea[]>('tareas', { select: 'id,titulo,estado,tecnico_id,notas,created_at', ticket_id: `eq.${t.id}`, order: 'created_at' });
  const tareas = data ?? [];
  return `<section class="tarjeta" id="tkx-tareas"><h3>Tareas${tareas.length ? ` <span class="chip">${tareas.length}</span>` : ''}</h3>
    ${tareas.length ? `<ul class="tkx-tareas">${tareas.map(x => `<li><strong>${esc(x.titulo)}</strong> <span class="chip ${x.estado === 'completada' ? 'bien' : ''}">${esc(ESTADOS_TAREA[x.estado] ?? x.estado)}</span>
      <br><small class="nota">${esc([x.tecnico_id ?? 'Sin asignar', x.notas, hace(x.created_at)].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>` : '<p class="nota">Sin tareas.</p>'}
    ${escribe ? `<details><summary>Añadir tarea</summary><form data-on-submit="tkxTarea" data-prevent="1">
        <label>Qué hay que hacer <input id="tkx-titulo" required maxlength="200"></label>
        <div class="in-campos"><label>Estado <select id="tkx-estado">${Object.entries(ESTADOS_TAREA).filter(([k]) => k !== 'archivada').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label>Técnico <select id="tkx-tecnico"><option value="">Sin asignar</option>${personas.map(p => `<option>${esc(p.nombre)}</option>`).join('')}</select></label></div>
        <label>Nota <input id="tkx-notas" maxlength="300" placeholder="p. ej. a quién llamar"></label>
        <div class="acciones"><button class="btn secundario" type="submit">Crear tarea</button></div></form></details>`
      : '<p class="nota">Las tareas se crean todavía en la app; aquí se ven.</p>'}</section>`;
}

/** Botón «Crear trabajo» de la sección Trabajo (solo con el área `trabajos` del hub). */
export const botonATrabajo = () => `<button class="btn secundario" data-action="tkxATrabajo">${ico('herramienta')} Crear trabajo desde el ticket</button>`;

/** Lo que va en la sección de cierre: guardar la resolución en la wiki (o ir a la página). */
export async function botonWiki(t: Ticket, cliente: string | null): Promise<string> {
  _t = t; _cliente = cliente;
  const { data } = await API.get<{ id: string }[]>('paginas', { select: 'id', ticket_id: `eq.${t.id}`, limit: '1' });
  const pg = data?.[0];
  return `<button type="button" class="btn secundario" data-action="tkxWiki">${ico('libro')} ${pg ? 'Actualizar en la wiki' : 'Guardar en la wiki'}</button>
    ${pg ? `<a class="btn secundario" href="#/wiki/${esc(pg.id)}">Ver la página</a>` : ''}`;
}

async function paginaResoluciones(): Promise<string | null> {
  const { data } = await API.get<{ id: string }[]>('paginas', { select: 'id', titulo: 'eq.Resoluciones', padre_id: 'is.null', archivada: 'eq.false', limit: '1' });
  if (data?.[0]) return data[0].id;
  const r = await API.post<{ id: string }[]>('paginas', { titulo: 'Resoluciones', contenido: 'Cómo se resolvieron los tickets: una página por ticket, guardada desde su ficha.' });
  return r.data?.[0]?.id ?? null;
}

registrarAcciones({
  async tkxTarea() {
    if (!_t) return;
    const titulo = val('tkx-titulo');
    if (!titulo) return;
    const r = await API.post('tareas', { id: crypto.randomUUID(), titulo, estado: val('tkx-estado') || 'pendiente', ticket_id: _t.id, tecnico_id: val('tkx-tecnico') || null, notas: val('tkx-notas') || null });
    if (r.error) { toast(`No se pudo crear la tarea: ${r.error.message}`, 'error'); return; }
    toast('Tarea creada');
    resolver();
  },
  async tkxDuplicar() {
    if (!_t) return;
    const t = _t;
    const r = await API.post<Ticket[]>('tickets', { titulo: `${t.titulo || 'Ticket'} (copia)`.slice(0, 200), descripcion: t.descripcion, estado: 'Abierto', prioridad: t.prioridad,
      tecnico_id: t.tecnico_id, via_contacto: t.via_contacto, canal: t.canal, cliente_id: t.cliente_id, local_id: t.local_id, contacto_id: t.contacto_id, email_de: t.email_de });
    if (r.error || !r.data?.[0]) { toast(`No se pudo duplicar: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
    toast(`Ticket duplicado: #${r.data[0].numero}`);
    ir('tickets', String(r.data[0].numero));
  },
  tkxATrabajo() {
    if (!_t) return;
    dejarBorrador('trabajo', { cliente_id: _t.cliente_id, local_id: _t.local_id, contacto_id: _t.contacto_id, titulo: _t.titulo, descripcion: _t.descripcion ?? undefined,
      tipo: 'Asistencia', ticket_id: _t.id, ticket_numero: _t.numero });
    ir('trabajos', 'nuevo');
  },
  async tkxWiki() {
    if (!_t) return;
    const t = _t;
    // En el formulario de cierre vale lo tecleado; cerrado, lo guardado.
    const resolucion = val('tk-resolucion') || (t.resolucion ?? '').trim();
    if (!resolucion) { toast('Escribe la resolución primero', 'error'); return; }
    const categoria = val('tk-categoria') || t.resolucion_categoria;
    const contenido = [`**Ticket #${t.numero}**${_cliente ? ` · ${_cliente}` : ''}${categoria ? ` · ${categoria}` : ''}`,
      t.descripcion ? `## Qué pasaba\n\n${t.descripcion}` : '', `## Cómo se resolvió\n\n${resolucion}`,
      `_Guardado desde el ticket por ${usuario()?.nombre ?? 'el equipo'}._`].filter(Boolean).join('\n\n');
    const titulo = `Resolución: ${t.titulo || `ticket #${t.numero}`}`.slice(0, 200);
    const { data: ya } = await API.get<{ id: string }[]>('paginas', { select: 'id', ticket_id: `eq.${t.id}`, limit: '1' });
    let id = ya?.[0]?.id ?? null;
    if (id) {
      const r = await API.patch('paginas', { id: `eq.${id}` }, { titulo, contenido, cliente_id: t.cliente_id });
      if (r.error) { toast(`No se pudo guardar en la wiki: ${r.error.message}`, 'error'); return; }
    } else {
      const padre = await paginaResoluciones();
      const r = await API.post<{ id: string }[]>('paginas', { titulo, contenido, padre_id: padre, ticket_id: t.id, cliente_id: t.cliente_id });
      if (r.error || !r.data?.[0]) { toast(`No se pudo guardar en la wiki: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
      id = r.data[0].id;
    }
    // Como la app: la resolución se queda también en el ticket.
    if (resolucion !== (t.resolucion ?? '').trim()) await API.patch('tickets', { id: `eq.${t.id}` }, { resolucion });
    void llamarFuncion('documentos-indexar', { accion: 'pagina', id });
    toast('Resolución guardada en la wiki');
    resolver();
  },
});
