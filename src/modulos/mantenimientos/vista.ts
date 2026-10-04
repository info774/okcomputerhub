// Vista de Mantenimientos (ver index.ts), con las pestañas de la app:
//   #/mantenimientos            Resumen (cifras, por plan, lo que requiere
//                               atención, próximas visitas, garantías)
//   #/mantenimientos/locales    la TABLA MAESTRA: una fila por sede con plan,
//                               cobro, certificado, copia, control horario,
//                               revisiones, teléfonos y código de verificación
//   #/mantenimientos/ficha/<id> la ficha de mantenimiento de una sede (ficha.ts)
//   #/mantenimientos/alta[/<id>] «+ Contrato»: plan, cuota y frecuencia de una sede (alta.ts)
//   #/mantenimientos/checklist  tareas del plan del periodo (checklist.ts)
//   #/mantenimientos/seguimiento el kanban comercial (seguimiento.ts)
//   #/mantenimientos/plantillas los planes, sus tareas y los checklists de visita (planes.ts)
//   #/mantenimientos/cobros/…   el cobro de las cuotas: Stripe + Zoho, solo admin (cobros.ts)
//   #/mantenimientos/documentos los contratos y sus renovaciones (documentos.ts)
//   #/mantenimientos/contrato/… generar, editar, enlace y firmado (contrato.ts)
// Reglas de la app (mant-estados.js) en datos.ts. Prefijo de ids: mt-.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { barras } from '../../ui/barras';
import { eur, telWhatsApp } from '../ventas/datos';
import {
  type Sede, type Pasarela, type Telefono, colsSede, pasarela, netoMensual, esTorcido, sinAcentos, PAGO_MAL, estadosDelPlan, diasHasta,
  fechaCorta, ROLES_SENSIBLES, textoCodigo, mesesDe, type Contrato, COLS_CONTRATO, contratoDeSede, renovacionesProximas,
} from './datos';

export const PESTANAS: [string, string][] = [['', 'Resumen'], ['locales', 'Locales'], ['cobros', 'Cobros'], ['checklist', 'Checklist'], ['seguimiento', 'Seguimiento'], ['plantillas', 'Plantillas'], ['documentos', 'Documentos']];
const PASARELA: Record<Pasarela, [string, string]> = {
  stripe: ['Stripe', 'bien'], espera: ['Esperando el primer pago', 'aviso'], zoho: ['Zoho (cartera vieja)', ''], nadie: ['Sin domiciliar', 'aviso'],
};
const FILTROS: [string, string][] = [['', 'Todas'], ['torcido', 'Cobro torcido'], ['en_curso', 'Cobro en curso'], ['nadie', 'Sin domiciliar'],
  ['espera', 'Esperando pago'], ['stripe', 'Stripe'], ['zoho', 'Zoho']];
const FICHA: [string, string][] = [['', 'Ficha: todo'], ['cert', 'Certificado vencido o ≤ 30 días'], ['sin_cert', 'Sin fecha de certificado'],
  ['backup', 'Copia del plan pendiente'], ['sin_backup', 'Sin copia en el plan'], ['ch', 'Control horario sin dato'], ['revision', 'Revisiones atrasadas'], ['sin_dueno', 'Sin teléfono de dueño']];

let _lista: Sede[] = [];
let _listaAt = 0;
let _clientes = new Map<string, { nombre: string; email: string | null }>();
let _tels = new Map<string, Telefono[]>();
let _backup = new Map<string, string>();
let _revision = new Map<string, string>();
let _contratos: Contrato[] = [];
let _bajas = new Set<string>();
let _renovSinAvisar = 0;  // la insignia de «Documentos»: renovaciones a 60 días sin avisar
let _q = '';
let _filtro = '';
let _plan = '';
let _ficha = '';

/** Olvida la lista en caché (tras cambiar algo de una sede). */
export function olvidarMantenimientos() { _lista = []; _listaAt = 0; }

const chipPago = (s: Sede) => {
  const n = sinAcentos(s.estado_pago);
  const dias = s.stripe_cobro_en_curso_at ? Math.floor((Date.now() - Date.parse(s.stripe_cobro_en_curso_at)) / 86_400_000) : -1;
  return `${s.estado_pago && n !== 'al corriente' ? `<span class="chip ${PAGO_MAL.includes(n) ? 'mal' : 'aviso'}">${esc(s.estado_pago)}</span>` : `<span class="chip bien">${esc(s.estado_pago ?? 'Al corriente')}</span>`}${
    s.stripe_cobro_en_curso_at ? ` <span class="chip ${dias >= 10 ? 'aviso' : ''}" title="SEPA tarda unos 6 días hábiles en liquidar">Cobro en curso · ${dias} d</span>` : ''}${
    s.stripe_ultimo_error ? ` <span class="chip mal" title="${esc(s.stripe_ultimo_error)}">Error de Stripe</span>` : ''}`;
};

async function cargar() {
  if (_lista.length && Date.now() - _listaAt < 5 * 60_000) return null;
  const [ls, cs, ts, ks, bs] = await Promise.all([
    API.fetchAll<Sede>('locales', { select: colsSede(), plan: 'not.in.("Sin mantenimiento","")', activo: 'neq.false', order: 'nombre' }),
    _clientes.size ? Promise.resolve(null) : API.fetchAll<{ id: string; nombre: string; email: string | null }>('clientes', { select: 'id,nombre,email' }),
    API.fetchAll<Telefono>('local_telefonos', { select: 'id,local_id,nombre,numero,rol', order: 'created_at' }),
    API.fetchAll<Contrato>('contratos', { select: COLS_CONTRATO, order: 'created_at.desc' }),
    API.fetchAll<{ id: string }>('locales', { select: 'id', activo: 'eq.false' }),
  ]);
  _bajas = new Set((bs.data ?? []).map(b => b.id));
  _contratos = ks.data ?? [];
  if (cs && !cs.error) _clientes = new Map((cs.data ?? []).map(c => [c.id, { nombre: c.nombre, email: c.email }]));
  if (ls.error) return ls.error;
  _lista = ls.data ?? []; _listaAt = Date.now();
  _tels = new Map();
  for (const t of ts.data ?? []) _tels.set(t.local_id, [...(_tels.get(t.local_id) ?? []), t]);
  ({ backup: _backup, revision: _revision } = await estadosDelPlan(_lista));
  _renovSinAvisar = renovaciones().filter(x => !x.r.avisado).length;
  return null;
}

// Las sedes de baja no cuentan para las renovaciones (como en la app).
const renovaciones = () => renovacionesProximas(_contratos, id => !!id && _bajas.has(id));
const nombreCliente = (s: Sede) => _clientes.get(s.cliente_id ?? '')?.nombre ?? '';
const certAlerta = (s: Sede) => { const d = diasHasta(s.cert_caducidad); return d != null && d <= 30; };
const sinDueno = (s: Sede) => !(_tels.get(s.id) ?? []).some(t => ROLES_SENSIBLES.includes(t.rol ?? ''));

function filtradas(): Sede[] {
  const q = sinAcentos(_q), dq = _q.replace(/\D/g, '');
  return _lista.filter(s => {
    if (_filtro === 'torcido' && !esTorcido(s) && !s.stripe_ultimo_error) return false;
    if (_filtro === 'en_curso' && !s.stripe_cobro_en_curso_at) return false;
    if (['nadie', 'espera', 'stripe', 'zoho'].includes(_filtro) && pasarela(s) !== _filtro) return false;
    if (_plan && s.plan !== _plan) return false;
    if (_ficha === 'cert' && !certAlerta(s)) return false;
    if (_ficha === 'sin_cert' && s.cert_caducidad) return false;
    if (_ficha === 'backup' && _backup.get(s.id) !== 'pendiente') return false;
    if (_ficha === 'sin_backup' && _backup.get(s.id) !== 'sin_backup') return false;
    if (_ficha === 'ch' && s.control_horario != null) return false;
    if (_ficha === 'revision' && _revision.get(s.id) !== 'atrasada') return false;
    if (_ficha === 'sin_dueno' && !sinDueno(s)) return false;
    if (!q) return true;
    return [s.nombre, s.plan, nombreCliente(s), s.codigo_verificacion].some(x => sinAcentos(x).includes(q))
      || (dq.length >= 3 && (_tels.get(s.id) ?? []).some(t => t.numero.replace(/\D/g, '').includes(dq)));
  });
}

/** Las pestañas; «Documentos» lleva las renovaciones a 60 días sin avisar (`renov` la pone al día quien las acaba de contar). */
export const navPestanas = (actual: string, renov?: number) => {
  if (renov != null) _renovSinAvisar = renov;
  // Cobros es dinero: solo para administración (como la app, que no la enseña al técnico).
  return `<nav class="pestanas" role="tablist" aria-label="Mantenimientos">${PESTANAS.filter(([k]) => k !== 'cobros' || esAdmin()).map(([k, n]) =>
    `<a role="tab" class="${k === actual ? 'activo' : ''}" aria-selected="${k === actual}" href="#/mantenimientos${k ? `/${k}` : ''}">${n}${k === 'documentos' && _renovSinAvisar
      ? ` <span class="insignia" title="Renovaciones en los próximos 2 meses sin avisar">${_renovSinAvisar}</span>` : ''}</a>`).join('')}</nav>`;
};

function cifra(titulo: string, valor: string, sub: string, tono = '', href = '') {
  return `<article class="tarjeta di-cifra ${tono}">${href ? `<a href="${href}">` : ''}<h3>${esc(titulo)}</h3><p class="di-valor">${valor}</p><p class="nota">${sub}</p>${href ? '</a>' : ''}</article>`;
}

// ── Resumen ─────────────────────────────────────────────────────────────────
async function pintarResumen(el: HTMLElement, escribe: boolean) {
  const admin = esAdmin();
  const hoyS = new Date().toLocaleDateString('sv-SE');
  const en = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
  const [visitas, garantias] = await Promise.all([
    API.get<any[]>('trabajos', { select: 'id,numero,titulo,fecha_programada,tecnicos,local_id', tipo: 'eq.Mantenimiento', estado: 'in.(Pendiente,"En progreso")', fecha_programada: `gte.${hoyS}`, order: 'fecha_programada', limit: '8' }),
    API.get<any[]>('local_hardware', { select: 'id,local_id,nombre,tipo,garantia', and: `(garantia.gte.${hoyS},garantia.lte.${en(30)})`, order: 'garantia', limit: '12' }),
  ]);
  const mes = _lista.reduce((t, s) => t + netoMensual(s), 0);
  const cuotas = _lista.filter(s => s.proxima_cuota && s.proxima_cuota >= hoyS && s.proxima_cuota <= en(90)).sort((a, b) => (a.proxima_cuota ?? '').localeCompare(b.proxima_cuota ?? ''));
  const pendientes = _lista.filter(s => sinAcentos(s.estado_pago) && sinAcentos(s.estado_pago) !== 'al corriente');
  const atencion = _lista.filter(s => (s.proxima_cuota && s.proxima_cuota < hoyS) || esTorcido(s) || !!s.stripe_ultimo_error).slice(0, 12);
  const porPlan = new Map<string, Sede[]>();
  for (const s of _lista) porPlan.set(s.plan ?? '—', [...(porPlan.get(s.plan ?? '—') ?? []), s]);
  const filas = [...porPlan.entries()].sort((a, b) => b[1].length - a[1].length).map(([p, ss]) => {
    const neto = ss.reduce((t, s) => t + netoMensual(s), 0);
    return admin
      ? { clave: p, etiqueta: p, valor: neto, texto: `${eur(neto)} <small class="nota">· ${ss.length}</small>`, detalle: `${p}: ${ss.length} sedes · ${eur(neto, 2)} al mes sin impuestos` }
      : { clave: p, etiqueta: p, valor: ss.length, texto: String(ss.length), detalle: `${p}: ${ss.length} sedes` };
  });
  const nombreSede = (id: string | null) => _lista.find(s => s.id === id)?.nombre ?? '';
  const alta = escribe && await esDelHub('mantenimientos_programados', 'clientes');
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('Mantenimientos')}${navPestanas('')}
    ${alta ? '<p class="acciones"><a class="btn" href="#/mantenimientos/alta">+ Contrato</a></p>' : ''}
    <div class="pp-cabeza"><div class="di-cifras pp-cifras">
      ${cifra('Contratos activos', String(_lista.length), `${porPlan.size} ${porPlan.size === 1 ? 'plan' : 'planes'}`, '', '#/mantenimientos/locales')}
      ${admin ? cifra('Recurrente al mes', eur(mes), `sin impuestos · ${eur(mes * 12)} al año`) : cifra('Cobra Stripe', String(_lista.filter(s => pasarela(s) === 'stripe').length), 'sedes domiciliadas')}
      ${cifra('Cuotas en 90 días', String(cuotas.length), cuotas[0] ? `la próxima, ${esc(fechaCorta(cuotas[0].proxima_cuota))} · ${esc(cuotas[0].nombre)}` : 'ninguna a la vista')}
      ${cifra('Pagos pendientes', String(pendientes.length), pendientes.length ? 'no están al corriente' : 'todas al corriente', pendientes.length ? 'mal' : '', '#/mantenimientos/locales')}
    </div>${barras('mt-barras', admin ? 'Cuota mensual por plan' : 'Sedes por plan', filas, 'mtPlanBarra', _plan)}</div>
    <div class="me-grid">
      <section class="tarjeta"><h3>⚠️ Requieren atención</h3>${atencion.length ? `<ul class="di-ultimo">${atencion.map(s => `<li><a href="#/sitios/${esc(s.id)}">${esc(s.nombre)}</a>
        <span>${s.proxima_cuota && s.proxima_cuota < hoyS ? `cuota vencida el ${esc(fechaCorta(s.proxima_cuota))} · ` : ''}${chipPago(s)}</span></li>`).join('')}</ul>` : '<p class="nota">Nada: todas las cuotas al día.</p>'}</section>
      <section class="tarjeta"><h3>🗓 Próximas visitas</h3>${(visitas.data ?? []).length ? `<ul class="di-ultimo">${(visitas.data ?? []).map(t => `<li><a href="#/trabajos/${t.numero}">#${t.numero} ${esc(t.titulo ?? '')}</a>
        <span class="nota">${esc(fechaCorta(t.fecha_programada))} · ${esc(nombreSede(t.local_id))} · ${esc((t.tecnicos ?? []).join(', ') || 'sin técnico')}</span></li>`).join('')}</ul>` : '<p class="nota">No hay visitas de mantenimiento programadas.</p>'}
        <p><a href="#/calendario">Ver el calendario →</a></p></section>
      <section class="tarjeta"><h3>🔁 Renovaciones (2 meses)</h3>${renovaciones().length ? `<ul class="di-ultimo" id="mt-renovaciones">${renovaciones().slice(0, 8).map(({ c, r }) => `<li>
        <a href="#/mantenimientos/contrato/${esc(c.id)}/ver">${esc(c.cliente_nombre || nombreSede(c.local_id) || '—')}</a>
        <span class="nota">${r.auto ? 'renueva' : '<span class="g-mal">vence</span>'} el ${esc(fechaCorta(r.fecha))}${r.avisado ? ' · avisado' : ''}</span></li>`).join('')}</ul>` : '<p class="nota">Ningún contrato cumple año en los próximos 2 meses.</p>'}
        <p><a href="#/mantenimientos/documentos">Ver los contratos →</a></p></section>
      <section class="tarjeta"><h3>🛡 Garantías a punto de vencer</h3>${(garantias.data ?? []).length ? `<ul class="di-ultimo">${(garantias.data ?? []).map(h => `<li><a href="#/sitios/${esc(h.local_id)}/hardware">${esc([h.tipo, h.nombre].filter(Boolean).join(' · ') || 'Equipo')}</a>
        <span class="nota">vence el ${esc(fechaCorta(h.garantia))}</span></li>`).join('')}</ul>` : '<p class="nota">Ninguna en los próximos 30 días.</p>'}</section>
    </div>`;
}

// ── Locales: la tabla maestra ───────────────────────────────────────────────
function celdaCert(s: Sede, escribe: boolean): string {
  const d = diasHasta(s.cert_caducidad);
  const nota = d == null ? '' : d < 0 ? '<small class="g-mal">Vencido</small>' : d <= 30 ? `<small class="g-aviso">En ${d} d</small>` : '';
  return escribe
    ? `<input type="date" value="${esc(s.cert_caducidad ?? '')}" aria-label="Caducidad del certificado de ${esc(s.nombre)}" data-on-change="mtCampo:${s.id},cert_caducidad,$value"> ${nota}`
    : `${esc(fechaCorta(s.cert_caducidad)) || '—'} ${nota}`;
}
function celdaBackup(s: Sede, escribe: boolean): string {
  const viejo = s.backup_tipo && s.backup_tipo !== 'ninguna' && (!s.backup_comprobado || (diasHasta(s.backup_comprobado) ?? 0) < -45);
  const plan = _backup.get(s.id);
  return `${esc([s.backup_tipo, s.backup_destino].filter(Boolean).join(' · ') || '—')}<br>
    ${escribe ? `<input type="date" class="${viejo ? 'g-aviso' : ''}" value="${esc(s.backup_comprobado ?? '')}" aria-label="Copia comprobada el" title="Comprobada el" data-on-change="mtCampo:${s.id},backup_comprobado,$value">`
      : `<small class="${viejo ? 'g-aviso' : 'nota'}">${s.backup_comprobado ? `comprobada ${esc(fechaCorta(s.backup_comprobado))}` : 'sin comprobar'}</small>`}
    ${plan === 'al_dia' ? ' <span class="chip bien">Plan al día</span>' : plan === 'pendiente' ? ' <span class="chip aviso">Plan pendiente</span>' : ''}`;
}
function celdaCh(s: Sede, escribe: boolean): string {
  const v = s.control_horario == null ? '' : s.control_horario ? 'si' : 'no';
  const extra = [s.control_horario_sistema, s.control_horario_nuestro ? 'nuestro' : ''].filter(Boolean).join(' · ');
  return `${escribe ? `<select aria-label="Control horario" data-on-change="mtCampo:${s.id},control_horario,$value">
      <option value="" ${v === '' ? 'selected' : ''}>¿?</option><option value="si" ${v === 'si' ? 'selected' : ''}>Sí</option><option value="no" ${v === 'no' ? 'selected' : ''}>No</option></select>`
    : ({ si: 'Sí', no: 'No', '': '¿?' } as Record<string, string>)[v]}${extra ? `<br><small class="nota">${esc(extra)}</small>` : ''}`;
}
function celdaTels(s: Sede): string {
  const ts = _tels.get(s.id) ?? [];
  if (!ts.length) return '<span class="g-mal">Sin teléfonos</span>';
  const sens = ts.filter(t => ROLES_SENSIBLES.includes(t.rol ?? '')).slice(0, 2);
  return `${sens.map(t => `<a href="tel:${esc(t.numero)}">${esc(t.numero)}</a> <small class="nota">${esc(t.nombre ?? '')}</small>`).join('<br>') || '<span class="g-aviso">Sin dueño</span>'}
    ${ts.length > sens.length ? `<br><small class="nota">${ts.length} en total</small>` : ''}`;
}
function celdaCodigo(s: Sede): string {
  if (!s.codigo_verificacion) return '—';
  const tel = (_tels.get(s.id) ?? []).find(t => ROLES_SENSIBLES.includes(t.rol ?? ''));
  const wa = telWhatsApp(tel?.numero);
  const email = _clientes.get(s.cliente_id ?? '')?.email;
  const txt = encodeURIComponent(textoCodigo(s.nombre, s.codigo_verificacion));
  return `<code>${esc(s.codigo_verificacion)}</code><br>${wa ? `<a href="https://wa.me/${wa}?text=${txt}" target="_blank" rel="noopener" title="Mandar el código por WhatsApp">💬</a> ` : ''}${
    email ? `<a href="mailto:${esc(email)}?subject=${encodeURIComponent(`Código de verificación · ${s.nombre}`)}&body=${txt}" title="Mandar el código por correo">✉️</a>` : ''}`;
}

// El documento de cada sede (contratoDeSede): firmar el pendiente, ver el
// firmado o crearlo relleno con lo que la sede ya tiene pactado.
let _escribeContratos = false;
function celdaContrato(s: Sede, escribe: boolean): string {
  const c = contratoDeSede(_contratos, s.id);
  if (c?.estado === 'pendiente') return `<a class="chip aviso" href="#/mantenimientos/contrato/${esc(c.id)}/enlace" title="Firmar el contrato">Sin firmar</a>`;
  if (c?.estado === 'firmado') return `<a class="chip bien" href="#/mantenimientos/contrato/${esc(c.id)}/ver" title="Ver el contrato firmado">Contrato firmado</a>`;
  return escribe && _escribeContratos ? `<a class="mt-crear" href="#/mantenimientos/contrato/nuevo/${esc(s.id)}">+ Crear contrato</a>` : '<small class="nota">Sin contrato</small>';
}

async function pintarLocales(el: HTMLElement, escribe: boolean) {
  _escribeContratos = await esDelHub('contratos');
  const admin = esAdmin();
  const planes = [...new Set(_lista.map(s => s.plan).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const lista = filtradas();
  const rev = (s: Sede) => ({ al_dia: '<span class="chip bien">Al día</span>', atrasada: '<span class="chip aviso">Atrasada</span>' } as Record<string, string>)[_revision.get(s.id) ?? ''] ?? '—';
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('La ficha de mantenimiento de las sedes')}${navPestanas('locales')}
    <div class="acciones mo-barra">
      <input id="mt-filtro" type="search" placeholder="Buscar por sede, cliente, plan, código o teléfono…" value="${esc(_q)}" data-on-input="mtFiltrar:$value" aria-label="Buscar sede">
      <select id="mt-plan" data-on-change="mtPlan:$value" aria-label="Plan"><option value="">Todos los planes</option>
        ${planes.map(p => `<option ${p === _plan ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <select id="mt-ficha" data-on-change="mtFicha:$value" aria-label="Ficha">${FICHA.map(([k, n]) => `<option value="${k}" ${k === _ficha ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      ${escribe && await esDelHub('mantenimientos_programados', 'clientes') ? '<a class="btn" href="#/mantenimientos/alta">+ Contrato</a>' : ''}
    </div>
    <div class="acciones mo-barra">${FILTROS.map(([k, n]) => `<button class="chip-boton ${_filtro === k ? 'activo' : ''}" data-action="mtFiltro" data-p0="${k}">${n}</button>`).join('')}</div>
    <p class="nota">Mostrando ${Math.min(lista.length, 300)} de ${lista.length}${admin ? ` · ${eur(lista.reduce((t, s) => t + netoMensual(s), 0), 2)} al mes sin impuestos` : ''}.</p>
    <div class="tarjeta mo-scroll"><table class="tabla mt-maestra" id="mt-tabla"><thead><tr><th>Sede</th><th>Plan y cuota</th><th>Cobro</th><th>Cert. digital</th><th>Copia de seguridad</th>
      <th>Control horario</th><th>Revisiones</th><th>Teléfonos</th><th>Código</th><th></th></tr></thead>
      <tbody>${lista.slice(0, 300).map(s => {
        const [txt, tono] = PASARELA[pasarela(s)];
        return `<tr data-sede="${esc(s.id)}">
        <td><a href="#/sitios/${esc(s.id)}"><strong>${esc(s.nombre)}</strong></a>${nombreCliente(s) ? `<br><small class="nota">${esc(nombreCliente(s))}</small>` : ''}${s.programa_tpv ? `<br><small class="nota">TPV ${esc(s.programa_tpv)}</small>` : ''}</td>
        <td><span class="chip">${esc(s.plan ?? '')}</span> ${celdaContrato(s, escribe)}${admin && s.importe_mantenimiento ? `<br>${eur(netoMensual(s), 2)}/mes${mesesDe(s.frecuencia_pago) > 1 ? ` <small class="nota">· ${esc(s.frecuencia_pago)}</small>` : ''}` : ''}</td>
        <td><span class="chip ${tono}">${esc(txt)}</span><br>${chipPago(s)}${s.proxima_cuota ? `<br><small class="${(diasHasta(s.proxima_cuota) ?? 99) <= 7 ? 'g-mal' : 'nota'}">Cuota ${esc(fechaCorta(s.proxima_cuota))}</small>` : ''}</td>
        <td>${celdaCert(s, escribe)}</td><td>${celdaBackup(s, escribe)}</td><td>${celdaCh(s, escribe)}</td><td>${rev(s)}</td>
        <td>${celdaTels(s)}</td><td>${celdaCodigo(s)}</td>
        <td><a class="btn secundario" href="#/mantenimientos/ficha/${esc(s.id)}">Ficha</a></td></tr>`;
      }).join('') || '<tr><td colspan="10" class="vacio">Ninguna sede con ese filtro.</td></tr>'}</tbody></table></div>`;
}

export async function pintarMantenimientos(el: HTMLElement, params: string[] = []) {
  const [p, id, sub] = params;
  if (p === 'ficha' && id) return (await import('./ficha')).pintarFicha(el, id);
  if (p === 'alta') return (await import('./alta')).pintarAlta(el, id);
  if (p === 'checklist') return (await import('./checklist')).pintarChecklist(el);
  if (p === 'seguimiento') return (await import('./seguimiento')).pintarSeguimiento(el, id);
  if (p === 'plantillas') return (await import('./planes')).pintarPlanes(el, id, sub);
  if (p === 'documentos') return (await import('./documentos')).pintarDocumentos(el);
  if (p === 'cobros') return (await import('./cobros')).pintarCobros(el, id, sub);
  if (p === 'contrato' && id) return (await import('./contrato')).pintarContrato(el, id, sub);
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [error, escribe] = await Promise.all([cargar(), esDelHub('locales')]);
  if (error && !_lista.length) { el.innerHTML = `<p class="aviso mal">No se pudieron leer las sedes: ${esc(error.message)}</p>`; return; }
  if (p === 'locales') await pintarLocales(el, escribe);
  else await pintarResumen(el, escribe);
}

let _timer: number | undefined;
registrarAcciones({
  mtFiltro(k: string) { _filtro = k; resolver(); },
  mtPlan(v: string) { _plan = v; resolver(); },
  mtFicha(v: string) { _ficha = v; resolver(); },
  // La barra de un plan lleva a la tabla filtrada por él; pulsarla otra vez lo quita.
  mtPlanBarra(v: string) { _plan = v === _plan ? '' : v; ir('mantenimientos', 'locales'); },
  mtFiltrar(v: string) {
    _q = v;
    clearTimeout(_timer);
    _timer = window.setTimeout(() => {
      resolver();
      window.setTimeout(() => { const f = document.getElementById('mt-filtro') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(v.length, v.length); }, 60);
    }, 250);
  },
  // mantSetCampo de la app: lo que se edita en la fila (certificado, copia comprobada, control horario).
  async mtCampo(id: string, campo: string, valor: string) {
    if (!['cert_caducidad', 'backup_comprobado', 'control_horario'].includes(campo)) return;
    const v = campo === 'control_horario' ? (valor === 'si' ? true : valor === 'no' ? false : null) : (valor || null);
    const r = await API.patch('locales', { id: `eq.${id}` }, { [campo]: v });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    const s = _lista.find(x => x.id === id);
    if (s) (s as unknown as Record<string, unknown>)[campo] = v;
    toast('Guardado');
  },
});
