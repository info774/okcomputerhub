// Checklist de la visita en la ficha del trabajo (portado de
// loadChecklistForTrabajo / saveChecklist de clientes.js de la app): si el
// trabajo ya tiene respuesta, se enseña con su plantilla; si no, y la sede
// lleva plan, la plantilla activa de ese plan o, a falta de ella, la genérica
// (sin plan). Completado = ningún obligatorio vacío o sin marcar. Las
// respuestas van con el área `trabajos`; las plantillas, con `mantenimiento`.
// Prefijo de ids: tcv-.
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { esc, toast } from '../../ui/dom';

interface Item { id: string; texto: string; tipo: 'check' | 'text' | 'number'; obligatorio?: boolean }
interface Plantilla { id: string | null; nombre: string; items: Item[] }

let _trabajo: string | null = null;
let _respId: string | null = null;
let _plantilla: Plantilla | null = null;

const hecho = (it: Item, v: unknown) => it.tipo === 'check' ? v === true : v !== undefined && v !== null && v !== '';

/** La sección entera (o '' si no toca checklist en este trabajo). */
export async function seccionChecklist(trabajoId: string, plan: string | null, escribe: boolean): Promise<string> {
  _trabajo = trabajoId; _respId = null; _plantilla = null;
  const { data: rs } = await API.get<{ id: string; plantilla_id: string | null; plantilla_nombre: string | null; respuestas: Record<string, unknown> | null; completado: boolean }[]>(
    'checklist_respuestas', { select: 'id,plantilla_id,plantilla_nombre,respuestas,completado', trabajo_id: `eq.${trabajoId}`, order: 'created_at', limit: '1' });
  let respuestas: Record<string, unknown> = {}, completado = false;
  const r = rs?.[0];
  if (r) {
    _respId = r.id; respuestas = r.respuestas ?? {}; completado = r.completado;
    const p = r.plantilla_id ? (await API.single<Plantilla>('checklist_plantillas', { select: 'id,nombre,items', id: `eq.${r.plantilla_id}` })).data : null;
    _plantilla = p ?? { id: r.plantilla_id, nombre: r.plantilla_nombre || 'Checklist', items: [] };
  } else {
    if (!plan || plan === 'Sin mantenimiento') return '';
    const { data: ps } = await API.get<(Plantilla & { plan: string | null })[]>('checklist_plantillas', { select: 'id,plan,nombre,items', activa: 'neq.false' });
    _plantilla = (ps ?? []).find(p => p.plan === plan) ?? (ps ?? []).find(p => !p.plan) ?? null;
    if (!_plantilla) return '';
  }
  const items = _plantilla.items ?? [];
  const n = items.filter(it => hecho(it, respuestas[it.id])).length;
  const dis = escribe ? '' : ' disabled';
  const ast = (it: Item) => it.obligatorio ? ' <span class="g-mal" aria-label="obligatorio">*</span>' : '';
  return `<section class="tarjeta" id="tcv"><div class="tarjeta-cab"><h3>Checklist de la visita</h3>
      <span class="chip ${completado || n === items.length ? 'bien' : 'aviso'}" id="tcv-insignia">${completado ? '✓ Completado' : `${n}/${items.length}`}</span></div>
    <p class="nota">${esc(_plantilla.nombre)}</p>
    <div class="tcv-items">${items.map(it => {
      const v = respuestas[it.id];
      if (it.tipo === 'check') return `<label class="check"><input type="checkbox" data-item="${esc(it.id)}" ${v === true ? 'checked' : ''} data-on-change="tcvContar"${dis}> <span${it.obligatorio ? ' class="fuerte"' : ''}>${esc(it.texto)}${ast(it)}</span></label>`;
      const campo = it.tipo === 'number'
        ? `<input type="number" data-item="${esc(it.id)}" value="${esc(String(v ?? ''))}" placeholder="0" data-on-input="tcvContar"${dis}>`
        : `<textarea data-item="${esc(it.id)}" rows="2" placeholder="Escribe aquí…" data-on-input="tcvContar"${dis}>${esc(String(v ?? ''))}</textarea>`;
      return `<label class="campo"><span${it.obligatorio ? ' class="fuerte"' : ''}>${esc(it.texto)}${ast(it)}</span>${campo}</label>`;
    }).join('') || '<p class="nota">La plantilla no tiene puntos.</p>'}</div>
    ${escribe && items.length ? '<p class="acciones"><button class="btn secundario" data-action="tcvGuardar">Guardar checklist</button></p>' : ''}</section>`;
}

function leerRespuestas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('#tcv [data-item]').forEach(el => {
    out[el.dataset.item!] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
  });
  return out;
}

registrarAcciones({
  tcvContar() {
    const ins = document.getElementById('tcv-insignia');
    if (!ins || !_plantilla) return;
    const rs = leerRespuestas(), items = _plantilla.items ?? [];
    const n = items.filter(it => hecho(it, rs[it.id])).length;
    ins.textContent = `${n}/${items.length}`;
    ins.className = `chip ${n === items.length ? 'bien' : 'aviso'}`;
  },
  async tcvGuardar() {
    if (!_trabajo || !_plantilla) return;
    const respuestas = leerRespuestas();
    // En la app, con la plantilla fuera de su caché, «completado» salía siempre
    // verdadero; aquí se mira la plantilla cargada.
    const completado = !(_plantilla.items ?? []).some(it => it.obligatorio && !hecho(it, respuestas[it.id]));
    const r = _respId
      ? await API.patch('checklist_respuestas', { id: `eq.${_respId}` }, { respuestas, completado })
      : await API.post<{ id: string }[]>('checklist_respuestas', { trabajo_id: _trabajo, plantilla_id: _plantilla.id, plantilla_nombre: _plantilla.nombre, respuestas, completado, tecnico_id: usuario()?.id ?? null });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    if (!_respId) _respId = (r.data as { id: string }[] | null)?.[0]?.id ?? null;
    const ins = document.getElementById('tcv-insignia');
    if (ins && completado) { ins.textContent = '✓ Completado'; ins.className = 'chip bien'; }
    toast(completado ? 'Checklist completado ✓' : 'Checklist guardado');
  },
});
