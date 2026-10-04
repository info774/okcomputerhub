// Documentos de Mantenimientos (pestaña «Documentos» de la app = Firmas +
// Renovaciones): #/mantenimientos/documentos. Los contratos con su estado
// (pendiente de firma, firmado, anulado) y el del cobro de su sede, y los que
// cumplen año en los próximos 60 días con el plazo de preaviso (30 días),
// «Marcar avisado» y «No renovar». Esto NO para el cobro ni avisa al cliente:
// lo apunta. Espejo `contratos` (área `mantenimiento`). Prefijo de ids: mdo-.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { navPestanas, olvidarMantenimientos } from './vista';
import {
  type Contrato, COLS_CONTRATO, renovacionDe, renovacionesProximas, contratosVigentes, sedeYaCobra, sedeEsperandoPago, normalizaFrecuencia,
  fechaCorta, diasEntre, hoyIso, RENOV_AVISO_DIAS, RENOV_PREAVISO_DIAS, type Sede,
} from './datos';
import { numEs } from './contrato-doc';

type SedeC = Pick<Sede, 'id' | 'nombre' | 'stripe_subscription_id' | 'stripe_mandato_estado' | 'zoho_subscription_id' | 'zoho_estado'> & { activo: boolean | null };
let _contratos: Contrato[] = [];
let _sedes = new Map<string, SedeC>();
let _renov = 'proximas';
let _filtro = '';

const ESTADO: Record<string, [string, string]> = { pendiente: ['Pendiente de firma', 'aviso'], firmado: ['Firmado', 'bien'], anulado: ['Anulado', 'mal'] };
const cuota = (c: Contrato) => Number(c.precio_mensual) > 0 ? `${numEs(Number(c.precio_mensual))} €/mes · pago ${(normalizaFrecuencia(c.frecuencia_pago) ?? 'Mensual').toLowerCase()}` : 'sin cuota';
const deBaja = (id: string | null) => !!id && _sedes.get(id)?.activo === false;

export async function pintarDocumentos(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [cs, escribe] = await Promise.all([API.fetchAll<Contrato>('contratos', { select: COLS_CONTRATO, order: 'created_at.desc' }), esDelHub('contratos')]);
  if (cs.error) { el.innerHTML = `<p class="aviso mal">${esc(cs.error.message)}</p>`; return; }
  _contratos = cs.data ?? [];
  const ids = [...new Set(_contratos.map(c => c.local_id).filter(Boolean))] as string[];
  _sedes = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await API.get<SedeC[]>('locales', { select: 'id,nombre,activo,stripe_subscription_id,stripe_mandato_estado,zoho_subscription_id,zoho_estado', id: `in.(${ids.slice(i, i + 100).join(',')})` });
    for (const s of data ?? []) _sedes.set(s.id, s);
  }
  const admin = esAdmin();
  const q = _filtro.toLowerCase();
  const lista = _contratos.filter(c => !q || [c.cliente_nombre, c.plan_nombre, _sedes.get(c.local_id ?? '')?.nombre].some(x => (x ?? '').toLowerCase().includes(q)));
  const proximas = renovacionesProximas(_contratos, deBaja);
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('Los contratos')}${navPestanas('documentos', proximas.filter(x => !x.r.avisado).length)}
    <div class="acciones mo-barra"><input id="mdo-q" type="search" placeholder="Buscar cliente, plan o sede…" value="${esc(_filtro)}" data-on-input="mdoBuscar:$value" aria-label="Buscar contrato">
      ${escribe ? '<a class="btn" href="#/mantenimientos/contrato/nuevo">✍ Firmar contrato</a>' : ''}</div>
    <section class="tarjeta"><h3>Contratos</h3>
      ${lista.length ? `<ul class="mdo-lista" id="mdo-lista">${lista.map(c => filaContrato(c, escribe, admin)).join('')}</ul>`
        : `<p class="vacio">${_contratos.length ? 'Ninguno con esa búsqueda.' : 'Sin contratos todavía. Se genera uno, se firma en el momento o se le manda el enlace al cliente.'}</p>`}</section>
    ${pintarRenovaciones(escribe)}`;
}

function filaContrato(c: Contrato, escribe: boolean, admin: boolean): string {
  const [txt, tono] = ESTADO[c.estado] ?? ESTADO.pendiente;
  const s = _sedes.get(c.local_id ?? '');
  const conCuota = Number(c.precio_mensual) > 0;
  const chipCobro = c.estado === 'firmado' && conCuota && s
    ? (sedeYaCobra(s) ? '<span class="chip bien">Cuota domiciliada</span>' : sedeEsperandoPago(s) ? '<span class="chip aviso">Esperando el primer pago</span>' : '<span class="chip aviso">Sin domiciliar</span>')
    : '';
  const fecha = c.estado === 'firmado' && c.firmado_at ? fechaCorta(c.firmado_at) : fechaCorta(c.created_at);
  return `<li data-contrato="${esc(c.id)}"><div class="mdo-cab"><strong>${esc(c.cliente_nombre || '—')}</strong> <span class="chip">${esc(c.plan_nombre)}</span>
      <span class="chip ${tono}">${txt}</span> ${chipCobro}</div>
    <p class="nota">${c.estado === 'firmado' ? `Firmado por ${esc(c.firmante_nombre || '—')} · ${esc(fecha)}` : `Generado el ${esc(fecha)}`}${s ? ` · <a href="#/sitios/${esc(s.id)}">${esc(s.nombre)}</a>` : ''} · ${esc(cuota(c))}</p>
    ${c.estado === 'firmado' && conCuota && !c.local_id ? '<p class="g-aviso">⚠ Sin sede asignada: la cuota no se puede cobrar. Asígnasela con «Editar».</p>' : ''}
    <div class="acciones">
      ${c.estado === 'pendiente' ? `<a class="btn" href="#/mantenimientos/contrato/${esc(c.id)}/enlace">✍ Firmar</a>` : ''}
      ${c.estado === 'firmado' ? `<a class="btn secundario" href="#/mantenimientos/contrato/${esc(c.id)}/ver">👁 Ver firmado</a>` : ''}
      ${c.estado !== 'anulado' ? `<a class="btn secundario" href="#/mantenimientos/contrato/${esc(c.id)}/enlace">🔗 Enlace / enviar</a>` : ''}
      ${c.estado !== 'anulado' && escribe ? `<a class="btn secundario" href="#/mantenimientos/contrato/${esc(c.id)}">✎ Editar</a>` : ''}
      ${c.estado === 'pendiente' && escribe && admin ? `<button class="btn secundario" data-action="mdoAnular" data-p0="${esc(c.id)}">✕ Anular</button>` : ''}
      ${escribe && admin ? `<button class="btn peligro" data-action="mdoEliminar" data-p0="${esc(c.id)}">🗑 Eliminar</button>` : ''}</div></li>`;
}

function pintarRenovaciones(escribe: boolean): string {
  const todos = contratosVigentes(_contratos).map(c => ({ c, r: renovacionDe(c)! })).filter(x => x.r).sort((a, b) => a.r.fecha.localeCompare(b.r.fecha));
  const proximas = renovacionesProximas(_contratos, deBaja);
  const sinAuto = todos.filter(x => !x.r.auto);
  const lista = _renov === 'todos' ? todos : _renov === 'sin-auto' ? sinAuto : proximas;
  const chip = (k: string, t: string, n: number) => `<button class="chip-boton ${_renov === k ? 'activo' : ''}" data-action="mdoRenov" data-p0="${k}" aria-pressed="${_renov === k}">${t} (${n})</button>`;
  const hoy = hoyIso();
  return `<section class="tarjeta" id="mdo-renov"><h3>Renovaciones</h3>
    <p class="nota">El contrato dura un año desde la firma y se renueva solo por periodos iguales salvo aviso por escrito con ${RENOV_PREAVISO_DIAS} días (cláusula 18). Esto no para el cobro ni avisa al cliente: lo apunta.</p>
    <div class="acciones">${chip('proximas', 'En renovación (2 meses)', proximas.length)}${chip('todos', 'Todos los firmados', todos.length)}${chip('sin-auto', 'No renuevan', sinAuto.length)}</div>
    ${lista.length ? `<ul class="mdo-lista" id="mdo-renov-lista">${lista.map(({ c, r }) => {
      const urgente = r.auto && r.dias <= RENOV_PREAVISO_DIAS;
      const tono = !r.auto ? 'mal' : urgente ? 'aviso' : '';
      const cuando = r.dias === 0 ? 'hoy' : r.dias === 1 ? 'mañana' : `en ${r.dias} días`;
      const s = _sedes.get(c.local_id ?? '');
      const preaviso = r.auto && r.dias <= RENOV_AVISO_DIAS
        ? (diasEntre(hoy, r.preaviso) >= 0 ? `<p class="${urgente ? 'g-aviso' : 'nota'}">⏰ Para no renovarlo hay que comunicarlo antes del ${esc(fechaCorta(r.preaviso))}.</p>`
          : `<p class="g-aviso">⚠ Pasado el plazo de preaviso (${esc(fechaCorta(r.preaviso))}): se renueva otro periodo.</p>`) : '';
      return `<li data-renov="${esc(c.id)}" class="${tono ? `mdo-${tono}` : ''}"><div class="mdo-cab"><strong>${esc(c.cliente_nombre || s?.nombre || '—')}</strong> <span class="chip">${esc(c.plan_nombre)}</span>
          ${r.auto ? '<span class="chip bien">Renovación automática</span>' : '<span class="chip mal">No renueva: vence</span>'}${r.avisado ? ' <span class="chip">Cliente avisado</span>' : ''}${s?.activo === false ? ' <span class="chip">Sede de baja</span>' : ''}</div>
        <p class="nota">${r.auto ? 'Renueva' : 'Vence'} el <strong>${esc(fechaCorta(r.fecha))}</strong> (${cuando}) · Año ${r.periodo} desde la firma del ${esc(fechaCorta(r.inicio))}${s ? ` · ${esc(s.nombre)}` : ''} · ${esc(cuota(c))}</p>
        ${preaviso}
        <div class="acciones"><a class="btn secundario" href="#/mantenimientos/contrato/${esc(c.id)}/ver">👁 Ver contrato</a>
          ${escribe ? `<button class="btn secundario" data-action="mdoAvisado" data-p0="${esc(c.id)}">${r.avisado ? '↩ Quitar el aviso' : '✓ Marcar avisado'}</button>
          <button class="btn ${r.auto ? 'peligro' : 'secundario'}" data-action="mdoAuto" data-p0="${esc(c.id)}">${r.auto ? 'No renovar' : 'Volver a renovar'}</button>` : ''}</div></li>`;
    }).join('')}</ul>`
      : `<p class="vacio">${_renov === 'proximas' ? `Ninguna renovación a la vista: aquí salen los firmados que cumplen año en los próximos ${RENOV_AVISO_DIAS} días.` : 'Nada que enseñar aquí.'}</p>`}</section>`;
}

let _timer: number | undefined;
registrarAcciones({
  mdoBuscar(v: string) {
    _filtro = v; clearTimeout(_timer);
    _timer = window.setTimeout(() => { resolver(); window.setTimeout(() => { const f = document.getElementById('mdo-q') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(v.length, v.length); }, 60); }, 250);
  },
  mdoRenov(k: string) { _renov = k; resolver(); },
  async mdoAvisado(id: string) {
    const c = _contratos.find(x => x.id === id); if (!c) return;
    const v = c.renovacion_avisada_at ? null : new Date().toISOString();
    const r = await API.patch('contratos', { id: `eq.${id}` }, { renovacion_avisada_at: v });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    toast(v ? 'Marcado como avisado' : 'Aviso retirado'); olvidarMantenimientos(); resolver();
  },
  // Apagar la renovación es una decisión con plazo: se confirma y se dice hasta cuándo.
  async mdoAuto(id: string) {
    const c = _contratos.find(x => x.id === id), r = renovacionDe(c ?? null);
    if (!c || !r) return;
    if (r.auto && !confirm(`El contrato dejará de renovarse y vencerá el ${fechaCorta(r.fecha)}. Comunícaselo al cliente por escrito: el contrato pide ${RENOV_PREAVISO_DIAS} días de antelación. Esto NO da de baja la cuota; si se le está cobrando, hay que pararla en Cobros.`)) return;
    const x = await API.patch('contratos', { id: `eq.${id}` }, { renovacion_automatica: !r.auto });
    if (x.error) { toast(`No se pudo guardar: ${x.error.message}`, 'error'); return; }
    toast(r.auto ? 'Marcado: vence y no se renueva' : 'El contrato vuelve a renovarse solo'); olvidarMantenimientos(); resolver();
  },
  async mdoAnular(id: string) {
    if (!confirm('¿Anular este contrato? El enlace dejará de permitir la firma.')) return;
    const r = await API.patch('contratos', { id: `eq.${id}` }, { estado: 'anulado' });
    if (r.error) { toast(`No se pudo anular: ${r.error.message}`, 'error'); return; }
    toast('Contrato anulado'); olvidarMantenimientos(); resolver();
  },
  async mdoEliminar(id: string) {
    const c = _contratos.find(x => x.id === id);
    const quien = c?.cliente_nombre ? `«${c.cliente_nombre}»` : 'este contrato';
    if (!confirm(c?.estado === 'firmado'
      ? `Se borrará el contrato de ${quien} CON su firma y el rastro de evidencia (fecha, IP y navegador de quien firmó). No se puede deshacer ni recuperar.`
      : `Se borrará el contrato de ${quien} y su enlace de firma dejará de existir. No se puede deshacer.`)) return;
    const r = await API.delete('contratos', { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo eliminar: ${r.error.message}`, 'error'); return; }
    toast('Contrato eliminado'); olvidarMantenimientos(); resolver();
  },
});
