// Gastos y cobros en efectivo de la app (paridad bloque 7, tanda 2: gastos.js),
// UNIFICADOS en Personas → Gastos junto a los tickets leídos por Claude
// (decisión de Fran). Espejo de `gastos` (área `gastos`): hasta el corte se
// ven aquí y se apuntan en la app; después, aquí:
//   #/personas/gastos/gasto[/t/<trabajo>]   gasto (importe, categoría, foto, vínculos)
//   #/personas/gastos/cobro[/t/<trabajo>]   cobro en efectivo (descripción obligatoria)
//   #/personas/gastos/mov/<id>              editar; eliminar solo admin (RLS)
// La foto va al almacén privado por `gastos-ocr` (acción `foto`); `foto_url`
// guarda `hub:gastos/<ruta>` y se abre con un enlace de minutos (`foto_url`).
// Las fotos viejas de la app (enlace de Drive o imagen incrustada) se abren tal
// cual. Prefijo de ids: pm-.
import { API } from '../../core/api';
import { esAdmin, usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { eur } from '../ventas/datos';

export interface Movimiento { id: string; created_at: string; tipo: string | null; importe: number; fecha: string | null; categoria: string | null; trabajo_id: string | null;
  tecnico_id: string | null; notas: string | null; foto_url: string | null; descripcion: string | null; contacto_id: string | null; local_id: string | null }
interface Ref { id: string; texto: string }

export const CATEGORIAS_APP: [string, string][] = [['Material', 'Material trabajo'], ['Herramienta', 'Herramienta o equipo'], ['Otro', 'Otro gasto']];
const REFS: Record<string, { tabla: string; select: string; buscar: (q: string) => Record<string, string>; texto: (f: any) => string }> = {
  trabajo: { tabla: 'trabajos', select: 'id,numero,titulo', texto: f => `#${f.numero ?? '?'} ${f.titulo ?? ''}`,
    buscar: (q): Record<string, string> => /^\d+$/.test(q) ? { numero: `eq.${q}` } : { titulo: `ilike.*${q}*`, order: 'numero.desc' } },
  contacto: { tabla: 'contactos', select: 'id,nombre', texto: f => f.nombre ?? '', buscar: q => ({ nombre: `ilike.*${q}*`, activo: 'neq.false', order: 'nombre' }) },
  local: { tabla: 'locales', select: 'id,nombre', texto: f => f.nombre ?? '', buscar: q => ({ nombre: `ilike.*${q}*`, activo: 'neq.false', order: 'nombre' }) },
};
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const aBase64 = (f: Blob) => new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = mal; r.readAsDataURL(f); });
const limpio = (q: string) => q.replace(/[*,()%\\]/g, ' ').trim().slice(0, 60);
let _foto: string | null = null;

async function nombres(movs: Movimiento[]) {
  const ids = (k: keyof Movimiento) => [...new Set(movs.map(m => m[k]).filter(Boolean) as string[])].slice(0, 150);
  const leer = async (k: keyof Movimiento, ref: string) => {
    const xs = ids(k);
    if (!xs.length) return new Map<string, string>();
    const r = await API.get<any[]>(REFS[ref].tabla, { select: REFS[ref].select, id: `in.(${xs.join(',')})` });
    return new Map((r.data ?? []).map(f => [f.id as string, REFS[ref].texto(f)]));
  };
  const [t, c, l] = await Promise.all([leer('trabajo_id', 'trabajo'), leer('contacto_id', 'contacto'), leer('local_id', 'local')]);
  return { t, c, l };
}

/** La tarjeta de Personas → Gastos con los gastos y cobros del mes. */
export async function seccionMovimientos(desde: string, hasta: string): Promise<string> {
  const [{ data, error }, delHub] = await Promise.all([
    API.get<Movimiento[]>('gastos', { select: '*', fecha: `gte.${desde}`, and: `(fecha.lte.${hasta})`, order: 'fecha.desc,created_at.desc', limit: '500' }),
    esDelHub('gastos')]);
  if (error) return `<p class="aviso mal">No se pudieron leer los gastos de la app: ${esc(error.message)}</p>`;
  const movs = data ?? [];
  const n = await nombres(movs);
  const gas = movs.filter(m => m.tipo !== 'cobro').reduce((s, m) => s + Number(m.importe ?? 0), 0);
  const cob = movs.filter(m => m.tipo === 'cobro').reduce((s, m) => s + Number(m.importe ?? 0), 0);
  const dis = delHub ? '' : 'disabled title="Hasta el cambio, se apuntan en la app"';
  return `<section class="tarjeta" id="pm-seccion"><div class="tarjeta-cab"><h3>${ico('dinero')} Gastos y cobros en efectivo</h3>
      <div class="acciones"><button class="btn secundario" data-action="pmNuevo" data-p0="gasto" ${dis}>${ico('mas')} Gasto</button>
        <button class="btn secundario" data-action="pmNuevo" data-p0="cobro" ${dis}>${ico('mas')} Cobro</button></div></div>
    ${delHub ? '' : avisoSoloLectura('Los gastos y cobros de los técnicos')}
    <p class="nota">Lo que apuntan los técnicos en la calle (antes, la pantalla «Gastos» de la app). Este mes: gastos ${eur(gas, 2)} · cobros ${eur(cob, 2)}.</p>
    <div class="mo-scroll">${movs.length ? `<table class="tabla" id="pm-lista"><thead><tr><th>Fecha</th><th>Qué</th><th>Quién</th><th>De</th><th class="num">Importe</th><th></th></tr></thead><tbody>
      ${movs.map(m => { const cobro = m.tipo === 'cobro';
        const de = [m.trabajo_id && n.t.get(m.trabajo_id), m.contacto_id && n.c.get(m.contacto_id), m.local_id && n.l.get(m.local_id)].filter(Boolean).join(' · ');
        return `<tr class="fila-clic" data-action="pmAbrir" data-p0="${esc(m.id)}"><td>${esc(m.fecha ?? '—')}</td>
          <td><span class="chip ${cobro ? 'bien' : 'aviso'}">${cobro ? 'Cobro' : 'Gasto'}</span> ${esc(m.descripcion || m.notas || m.categoria || '')}</td>
          <td>${esc(m.tecnico_id ?? '')}</td><td>${esc(de)}</td>
          <td class="num"><strong>${cobro ? '+' : '−'}${eur(m.importe, 2)}</strong></td>
          <td>${m.foto_url ? `<button class="btn secundario" data-action="pmFoto" data-p0="${esc(m.id)}" data-stop="1" aria-label="Ver la foto">${ico('imagen')}</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table>` : '<p class="vacio">Sin gastos ni cobros este mes.</p>'}</div></section>`;
}

const refCampo = (k: string, t: string, ref: Ref | null, dis: string) => `<label>${t} <input id="pm-${k}-q" type="search" autocomplete="off" placeholder="Buscar…" value="${esc(ref?.texto ?? '')}"
    data-on-input="pmBuscar:${k},$value" ${dis}><input type="hidden" id="pm-${k}" value="${esc(ref?.id ?? '')}"><ul class="inw-cat" id="pm-${k}-res"></ul></label>`;

export async function vistaMovimiento(tipo: 'gasto' | 'cobro' | 'mov', id: string, trabajoId = ''): Promise<string> {
  _foto = null;
  const [delHub, r] = await Promise.all([esDelHub('gastos'), tipo === 'mov' ? API.single<Movimiento>('gastos', { select: '*', id: `eq.${id}` }) : Promise.resolve({ data: null, error: null })]);
  const m = r.data;
  if (tipo === 'mov' && !m) return '<p class="aviso mal">No se encontró ese movimiento.</p><p><a href="#/personas/gastos">← Gastos</a></p>';
  const cobro = tipo === 'cobro' || m?.tipo === 'cobro';
  const dis = delHub ? '' : 'disabled';
  const base = m ?? ({ trabajo_id: trabajoId || null, contacto_id: null, local_id: null } as Partial<Movimiento>);
  const n = await nombres([base as Movimiento]);
  const ref = (k: 'trabajo_id' | 'contacto_id' | 'local_id', mapa: Map<string, string>) => base[k] ? { id: base[k] as string, texto: mapa.get(base[k] as string) ?? '' } : null;
  return `<p><a href="#/personas/gastos">← Gastos</a></p>${delHub ? '' : avisoSoloLectura('Los gastos y cobros de los técnicos')}
    <form class="tarjeta" id="pm-form" data-on-submit="pmGuardar" data-prevent="1" data-id="${esc(m?.id ?? '')}" data-tipo="${cobro ? 'cobro' : 'gasto'}">
      <h3>${m ? (cobro ? 'Editar cobro' : 'Editar gasto') : cobro ? 'Nuevo cobro en efectivo' : 'Nuevo gasto'}</h3>
      <div class="in-campos">
        <label>Importe (€) <input id="pm-importe" type="number" step="0.01" min="0.01" required value="${esc(m?.importe ?? '')}" ${dis}></label>
        <label>Fecha <input id="pm-fecha" type="date" value="${esc(m?.fecha ?? new Date().toLocaleDateString('sv-SE'))}" ${dis}></label>
        ${cobro ? '' : `<label>Categoría <select id="pm-categoria" ${dis}>${CATEGORIAS_APP.map(([k, t]) => `<option value="${k}" ${k === (m?.categoria ?? 'Material') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`}
        ${m ? `<label>Quién <input id="pm-tecnico" value="${esc(m.tecnico_id ?? '')}" ${dis}></label>` : ''}
      </div>
      <label>${cobro ? 'Descripción (qué se cobró y a quién)' : 'Notas'} <input id="pm-texto" value="${esc((cobro ? m?.descripcion : m?.notas) ?? (m?.descripcion || m?.notas) ?? '')}" ${cobro ? 'required' : ''} ${dis}></label>
      <div class="in-campos">${refCampo('trabajo', 'Trabajo', ref('trabajo_id', n.t), dis)}${refCampo('contacto', 'Contacto', ref('contacto_id', n.c), dis)}${refCampo('local', 'Sede', ref('local_id', n.l), dis)}</div>
      ${cobro ? '' : `<label>Foto del ticket <input id="pm-foto" type="file" accept="image/*,application/pdf" capture="environment" data-on-change="pmSubirFoto:$this" ${dis}></label>
        <p class="nota" id="pm-foto-estado">${m?.foto_url ? `<button type="button" class="btn secundario" data-action="pmFoto" data-p0="${esc(m.id)}">${ico('imagen')} Ver la foto</button>` : ''}</p>`}
      <div class="acciones"><button class="btn" type="submit" ${dis}>Guardar</button>
        ${m && esAdmin() ? `<button type="button" class="btn peligro" data-action="pmBorrar" data-p0="${esc(m.id)}" ${dis}>Eliminar</button>` : ''}</div>
    </form>`;
}

registrarAcciones({
  pmAbrir(id: string) { ir('personas', 'gastos', 'mov', id); },
  pmNuevo(tipo: string) { ir('personas', 'gastos', tipo); },
  async pmFoto(id: string) {
    const { data } = await API.single<Movimiento>('gastos', { select: 'id,foto_url', id: `eq.${id}` });
    const u = data?.foto_url ?? '';
    if (/^https:\/\//.test(u)) { window.open(u, '_blank', 'noopener'); return; }
    if (u.startsWith('data:image/')) { const w = window.open('', '_blank'); if (w) w.document.body.innerHTML = `<img src="${u.replace(/"/g, '')}" style="max-width:100%">`; return; }
    const r = await llamarFuncion<{ url: string }>('gastos-ocr', { accion: 'foto_url', id });
    if (r.data?.url) window.open(r.data.url, '_blank', 'noopener'); else toast(r.error ?? 'No se pudo abrir la foto', 'error');
  },
  async pmBuscar(k: string, q: string) {
    const cfg = REFS[k], ul = document.getElementById(`pm-${k}-res`);
    if (!cfg || !ul) return;
    (document.getElementById(`pm-${k}`) as HTMLInputElement).value = '';
    const t = limpio(q);
    if (t.length < 2 && !/^\d+$/.test(t)) { ul.innerHTML = ''; return; }
    const r = await API.get<any[]>(cfg.tabla, { select: cfg.select, ...cfg.buscar(t), limit: '6' });
    ul.innerHTML = (r.data ?? []).map(f => `<li><button type="button" class="chip-boton" data-action="pmElegir" data-p0="${k}" data-p1="${esc(f.id)}" data-p2="${esc(cfg.texto(f))}">${esc(cfg.texto(f))}</button></li>`).join('')
      || '<li class="nota">Nada.</li>';
  },
  pmElegir(k: string, id: string, texto: string) {
    (document.getElementById(`pm-${k}`) as HTMLInputElement).value = id;
    (document.getElementById(`pm-${k}-q`) as HTMLInputElement).value = texto;
    document.getElementById(`pm-${k}-res`)!.innerHTML = '';
  },
  async pmSubirFoto(input: HTMLInputElement) {
    const f = input.files?.[0], p = document.getElementById('pm-foto-estado')!;
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { p.textContent = 'La foto pasa de 12 MB.'; return; }
    p.textContent = 'Subiendo…';
    const r = await llamarFuncion<{ foto_url: string }>('gastos-ocr', { accion: 'foto', archivo: await aBase64(f), tipo: f.type || 'image/jpeg' }, 90000);
    if (r.error || !r.data?.foto_url) { p.textContent = `No se pudo subir: ${r.error ?? 'sin respuesta'}`; return; }
    _foto = r.data.foto_url;
    p.textContent = 'Foto lista: se guarda con el gasto.';
  },
  async pmGuardar() {
    const form = document.getElementById('pm-form') as HTMLElement;
    const id = form.dataset.id || null, cobro = form.dataset.tipo === 'cobro';
    const importe = Number(val('pm-importe').replace(',', '.'));
    if (!importe || importe <= 0) { toast('El importe es obligatorio', 'error'); return; }
    if (cobro && !val('pm-texto')) { toast('La descripción es obligatoria', 'error'); return; }
    const d: Record<string, unknown> = { importe, fecha: val('pm-fecha') || new Date().toLocaleDateString('sv-SE'),
      trabajo_id: val('pm-trabajo') || null, contacto_id: val('pm-contacto') || null, local_id: val('pm-local') || null };
    if (cobro) d.descripcion = val('pm-texto') || null; else { d.notas = val('pm-texto') || null; d.categoria = val('pm-categoria') || 'Material'; }
    if (_foto) d.foto_url = _foto;
    if (id) d.tecnico_id = val('pm-tecnico') || null; else { d.tipo = cobro ? 'cobro' : 'gasto'; d.tecnico_id = usuario()?.nombre ?? null; }
    const r = id ? await API.patch('gastos', { id: `eq.${id}` }, d) : await API.post('gastos', d);
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    _foto = null;
    toast(cobro ? 'Cobro guardado' : 'Gasto guardado');
    ir('personas', 'gastos');
  },
  async pmBorrar(id: string) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    const r = await API.delete('gastos', { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Movimiento eliminado');
    ir('personas', 'gastos');
  },
});
