// Calendario (fase Final): semana de lunes a domingo, por día o por técnico,
// con la capa real (fichajes). Con el área `agenda` cortada, un bloque se
// arrastra a otro día (hub.agenda_mover conserva las horas). Prefijo: ca-.
import { API } from '../../core/api';
import { equipo } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { esMio } from '../trabajos/vista';

interface Bloque { id: string; trabajo_id: string | null; tarea_id: string | null; ticket_id: string | null; titulo: string | null; inicio: string; fin: string; tecnicos: string[] | null; estado: string | null; todo_el_dia: boolean | null }
const DIA_MS = 86400000;
const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const lunes = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const clave = (d: Date) => d.toLocaleDateString('sv-SE');
const hora = (v: string) => new Date(v).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
// Los técnicos van por nombre, completo o de pila («Matteo» / «Matteo Monastero»).
const coincide = (guardado: string, persona: string) => { const a = norm(guardado), b = norm(persona); return a === b || a === b.split(/\s+/)[0]; };
const COLORES = ['#2a78d6', '#eb6834', '#1f8a4c', '#8e44ad', '#c0392b', '#16a085', '#d4a017'];
let _arrastrando: string | null = null;
let _bloques: Bloque[] = [];

export async function pintar(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const inicio = new Date(Number(leer('hub_ca_semana', String(lunes(new Date()).getTime()))));
  const fin = new Date(inicio.getTime() + 7 * DIA_MS);
  const modo = leer('hub_ca_modo', 'dias');
  const [ag, ses, personas, escribe] = await Promise.all([
    API.get<Bloque[]>('agenda', { select: 'id,trabajo_id,tarea_id,ticket_id,titulo,inicio,fin,tecnicos,estado,todo_el_dia', and: `(inicio.lt.${fin.toISOString()},fin.gt.${inicio.toISOString()})`, order: 'inicio' }),
    API.get<any[]>('sesiones', { select: 'id,entidad_tipo,entidad_id,inicio,fin,tecnico_nombre', inicio: `gte.${inicio.toISOString()}`, and: `(inicio.lt.${fin.toISOString()})`, order: 'inicio' }),
    equipo(), esDelHub('agenda')]);
  _bloques = ag.data ?? [];
  const tids = [...new Set(_bloques.map(b => b.trabajo_id).filter(Boolean))];
  const trab = tids.length ? (await API.get<any[]>('trabajos', { select: 'id,numero,titulo,cliente_id', id: `in.(${tids.join(',')})` })).data ?? [] : [];
  const soloMios = leer('hub_ca_mios', '') === '1';
  const color = (n: string) => COLORES[Math.abs([...n].reduce((a, c) => a + c.charCodeAt(0), 0)) % COLORES.length];
  const titulo = (b: Bloque) => { const t = trab.find(x => x.id === b.trabajo_id); return t ? `#${t.numero} ${t.titulo ?? ''}` : b.titulo ?? (b.tarea_id ? 'Tarea' : b.ticket_id ? 'Ticket' : 'Cita'); };
  const visibles = _bloques.filter(b => !soloMios || esMio(b.tecnicos));
  const tarjeta = (b: Bloque) => `<article class="ca-bloque" ${escribe ? `draggable="true" data-on-dragstart="caArrastrar:$this"` : ''} data-id="${b.id}" style="border-left-color:${color((b.tecnicos ?? [''])[0] ?? '')}">
    <strong>${b.todo_el_dia ? 'Todo el día' : `${hora(b.inicio)}–${hora(b.fin)}`}</strong> ${b.trabajo_id ? `<a href="#/trabajos/${trab.find(x => x.id === b.trabajo_id)?.numero ?? ''}">${esc(titulo(b))}</a>` : esc(titulo(b))}
    <small class="nota">${esc((b.tecnicos ?? []).join(', '))}</small></article>`;
  const real = (s: any) => `<div class="ca-real" title="Fichado">⏱ ${hora(s.inicio)}–${s.fin ? hora(s.fin) : 'en curso'} · ${esc(s.tecnico_nombre ?? '')}</div>`;
  const dias = Array.from({ length: 7 }, (_, i) => new Date(inicio.getTime() + i * DIA_MS));
  const hoy = clave(new Date());
  const cuerpo = modo === 'tecnicos'
    ? `<div class="tarjeta mo-scroll"><table class="tabla ca-tabla"><thead><tr><th>Técnico</th>${dias.map(d => `<th class="${clave(d) === hoy ? 'ca-hoy' : ''}">${esc(d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }))}</th>`).join('')}</tr></thead><tbody>
        ${personas.filter(p => !soloMios || esMio([p.nombre])).map(p => `<tr><th>${esc(p.nombre)}</th>${dias.map(d => `<td>${visibles.filter(b => clave(new Date(b.inicio)) === clave(d) && (b.tecnicos ?? []).some(t => coincide(t, p.nombre))).map(tarjeta).join('')}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`
    : `<div class="ca-semana">${dias.map(d => `<section class="tarjeta ca-dia ${clave(d) === hoy ? 'ca-hoy' : ''}" data-dia="${clave(d)}" ${escribe ? `data-on-dragover="caSobre" data-prevent="1" data-on-drop="caSoltar:${clave(d)}"` : ''}>
        <h3>${esc(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' }))}</h3>
        ${visibles.filter(b => clave(new Date(b.inicio)) === clave(d)).map(tarjeta).join('') || '<p class="vacio">—</p>'}
        ${(ses.data ?? []).filter(s => clave(new Date(s.inicio)) === clave(d) && (!soloMios || esMio([s.tecnico_nombre]))).map(real).join('')}</section>`).join('')}</div>`;
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('La agenda')}
    <div class="acciones pr-barra"><button class="btn secundario" data-action="caSemana" data-p0="-1" aria-label="Semana anterior">‹</button>
      <strong>${esc(inicio.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }))} – ${esc(new Date(fin.getTime() - DIA_MS).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }))}</strong>
      <button class="btn secundario" data-action="caSemana" data-p0="1" aria-label="Semana siguiente">›</button><button class="btn secundario" data-action="caSemana" data-p0="0">Hoy</button>
      <div class="segmentado"><button class="${modo === 'dias' ? 'activo' : ''}" data-action="caModo" data-p0="dias">Por día</button><button class="${modo === 'tecnicos' ? 'activo' : ''}" data-action="caModo" data-p0="tecnicos">Por técnico</button></div>
      <label class="check"><input type="checkbox" ${soloMios ? 'checked' : ''} data-on-change="caMios:$checked"> Solo lo mío</label></div>
    ${cuerpo}<p class="nota">⏱ = lo fichado de verdad. ${escribe ? 'Arrastra un bloque a otro día para moverlo (conserva las horas).' : ''}</p>`;
}

registrarAcciones({
  caSemana(d: string) {
    const actual = Number(leer('hub_ca_semana', String(lunes(new Date()).getTime())));
    guardar('hub_ca_semana', String(d === '0' ? lunes(new Date()).getTime() : actual + Number(d) * 7 * DIA_MS));
    resolver();
  },
  caModo(m: string) { guardar('hub_ca_modo', m); resolver(); },
  caMios(v: boolean) { guardar('hub_ca_mios', v ? '1' : ''); resolver(); },
  caArrastrar(el: HTMLElement) { _arrastrando = el.dataset.id ?? null; },
  caSobre() { /* deja soltar */ },
  async caSoltar(dia: string) {
    const b = _bloques.find(x => x.id === _arrastrando);
    _arrastrando = null;
    if (!b) return;
    const desde = new Date(b.inicio), dur = new Date(b.fin).getTime() - desde.getTime();
    const nuevo = new Date(`${dia}T${desde.toTimeString().slice(0, 8)}`);
    if (clave(nuevo) === clave(desde)) return;
    const r = await API.rpc('agenda_mover', { p_id: b.id, p_inicio: nuevo.toISOString(), p_fin: new Date(nuevo.getTime() + dur).toISOString() });
    if (r.error) toast(r.error.message, 'error'); else { toast('Movido'); resolver(); }
  },
});
