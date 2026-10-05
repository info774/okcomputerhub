// Portal de clientes, la parte del EQUIPO (fase 7, solo admins): quién tiene
// acceso (invitar, revocar, generar el enlace para mandarlo a mano), qué ha
// hecho cada acceso (traza) y los presupuestos que los clientes han aceptado
// desde el portal y falta pasar a la app. Prefijo de ids: pt-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast, hace, fechaHora } from '../../ui/dom';
import { ico, type IconoLinea } from '../../shell/linea';
import { buscarClientes, nombresClientes, eur } from '../ventas/datos';

const URL_PORTAL = `${location.origin}/portal.html`;
// Qué hizo cada acceso: icono (opcional) y texto.
const ACCION: Record<string, [IconoLinea | null, string]> = { entrada: ['abierto', 'Entró'], salir: [null, 'Salió'], enlace_enviado: ['correo', 'Enlace enviado'], enlace_error: ['atencion', 'No se pudo enviar el enlace'],
  enlace_generado: ['enlace', 'Enlace generado por el equipo'], enlace_desconocido: ['ayuda', 'Pidió enlace un correo sin acceso'], enlace_limite: ['prohibido', 'Demasiados enlaces pedidos'],
  ver_ticket: [null, 'Vio un ticket'], g_jornada: ['libreta', 'Gestoría: vio la jornada'], g_ausencias: ['libreta', 'Gestoría: vio las ausencias'], g_gastos: ['libreta', 'Gestoría: vio los gastos'],
  g_gasto_url: ['libreta', 'Gestoría: abrió un ticket de gasto'], g_facturas: ['libreta', 'Gestoría: vio las facturas'], g_cierre: ['libreta', 'Gestoría: cierre del mes'], g_personas: ['libreta', 'Gestoría: entró'], abrir_ticket: ['etiqueta', 'Abrió un ticket'], mensaje_ticket: ['mensaje', 'Escribió en un ticket'], aceptar_presupuesto: ['hecho', 'Aceptó un presupuesto'],
  descargar_factura: ['descargar', 'Descargó una factura'], descargar_presupuesto: ['descargar', 'Descargó un presupuesto'], revocado: ['prohibido', 'Acceso revocado'] };
const accionHtml = (k: string) => { const a = ACCION[k]; return a ? `${a[0] ? `${ico(a[0])} ` : ''}${esc(a[1])}` : esc(k); };
let _timer = 0;

async function pintar(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [acc, tr, ac] = await Promise.all([
    API.get<any[]>('portal_accesos', { select: '*', order: 'activo.desc,created_at.desc' }),
    API.get<any[]>('portal_traza', { select: '*', order: 'created_at.desc', limit: '80' }),
    API.get<any[]>('portal_aceptaciones', { select: '*', order: 'created_at.desc', limit: '50' }),
  ]);
  if (acc.error) { el.innerHTML = `<p class="aviso mal">${esc(acc.error.message)}</p>`; return; }
  const accesos = acc.data ?? [];
  const nombres = await nombresClientes(accesos.map(a => a.cliente_id));
  const presIds = (ac.data ?? []).map(a => a.presupuesto_id);
  const pres = presIds.length ? (await API.get<any[]>('presupuestos', { select: 'id,numero_presupuesto,titulo,total,cliente_id', id: `in.(${presIds.join(',')})` })).data ?? [] : [];
  const emailDe = new Map(accesos.map(a => [a.id, a.email]));
  el.innerHTML = `<p class="nota">El área de clientes está en <a href="${esc(URL_PORTAL)}" target="_blank" rel="noopener">${esc(URL_PORTAL)}</a>
      (cuando esté el dominio, <strong>clientes.okcomputertenerife.com</strong>). Solo entran los correos invitados aquí, con un enlace de un solo uso que les llega por correo.</p>
    ${(ac.data ?? []).some(a => !a.revisada_at) ? `<section class="tarjeta"><h3>Presupuestos aceptados en el portal</h3><ul class="di-ultimo">${(ac.data ?? []).filter(a => !a.revisada_at).map(a => {
      const p = pres.find(x => x.id === a.presupuesto_id);
      return `<li><small class="nota">${esc(hace(a.created_at))}</small><span><strong>${esc(p?.numero_presupuesto ?? '')} ${esc(p?.titulo ?? '')}</strong> · ${eur(p?.total, 2)}
        · lo aceptó ${esc(a.nombre)}${a.comentario ? ` («${esc(a.comentario)}»)` : ''}
        <button class="btn secundario" data-action="ptRevisada" data-p0="${esc(a.id)}">Ya está pasado a la app</button></span></li>`;
    }).join('')}</ul></section>` : ''}
    <section class="tarjeta"><h3>Dar acceso</h3>
      <form data-on-submit="ptInvitar" data-prevent="1"><div class="in-campos">
        <label>Para <select id="pt-tipo" data-on-change="ptTipo:$value"><option value="cliente">Un cliente (portal)</option><option value="gestoria">La gestoría</option></select></label>
        <label id="pt-cliente-l">Cliente <input id="pt-cliente-q" autocomplete="off" placeholder="Buscar…" data-on-input="ptBuscarCliente:$value"></label>
        <label>Correo <input id="pt-email" type="email" required></label>
        <label>Nombre <input id="pt-nombre" placeholder="Para saludarle"></label></div>
        <input type="hidden" id="pt-cliente"><ul id="pt-cliente-res" class="resultados"></ul>
        <div class="acciones"><button class="btn" type="submit">Dar acceso</button></div></form></section>
    <section class="tarjeta mo-scroll"><h3>Accesos</h3>${accesos.length ? `<table class="tabla"><thead><tr><th>Correo</th><th>Cliente</th><th>Última entrada</th><th></th></tr></thead><tbody>
      ${accesos.map(a => `<tr class="${a.activo ? '' : 'in-pausado'}"><td>${esc(a.email)}${a.nombre ? `<br><small class="nota">${esc(a.nombre)}</small>` : ''}</td>
        <td>${a.tipo === 'gestoria' ? `<span class="chip">${ico('libreta')} Gestoría</span>` : a.cliente_id ? `<a href="#/clientes/${esc(a.cliente_id)}">${esc(nombres.get(a.cliente_id) ?? '')}</a>` : ''}</td>
        <td>${a.activo ? esc(a.ultima_entrada_at ? hace(a.ultima_entrada_at) : 'nunca') : `<span class="chip">revocado ${esc(hace(a.revocado_at))}</span>`}</td>
        <td><div class="acciones">${a.activo ? `<button class="btn secundario" data-action="ptEnlace" data-p0="${esc(a.id)}">Generar enlace</button>
          <button class="btn peligro" data-action="ptActivo" data-p0="${esc(a.id)}" data-p1="0">Revocar</button>`
          : `<button class="btn secundario" data-action="ptActivo" data-p0="${esc(a.id)}" data-p1="1">Reactivar</button>`}</div></td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Nadie tiene acceso todavía.</p>'}
      <div id="pt-enlace"></div></section>
    <section class="tarjeta"><h3>Qué han hecho (lo último)</h3><ul class="di-ultimo">${(tr.data ?? []).map(t => `<li><small class="nota" title="${esc(fechaHora(t.created_at))}">${esc(hace(t.created_at))}</small>
      <span>${accionHtml(t.accion)} · ${esc(t.email ?? emailDe.get(t.acceso_id) ?? '')}${t.detalle?.numero ? ` · #${esc(t.detalle.numero)}` : ''}${t.detalle?.mes ? ` · ${esc(t.detalle.mes)}` : ''}${t.detalle?.error ? ` · <small class="mal">${esc(t.detalle.error)}</small>` : ''}</span></li>`).join('') || '<li class="nota">Nada todavía.</li>'}</ul></section>`;
}

registrarAcciones({
  ptBuscarCliente(q: string) {
    clearTimeout(_timer);
    (document.getElementById('pt-cliente') as HTMLInputElement).value = '';
    _timer = window.setTimeout(async () => {
      const ul = document.getElementById('pt-cliente-res');
      if (!ul) return;
      ul.innerHTML = (await buscarClientes(q)).map(c => `<li><button type="button" class="btn secundario" data-action="ptElegirCliente" data-p0="${esc(c.id)}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}</button></li>`).join('');
    }, 250);
  },
  async ptElegirCliente(id: string, nombre: string) {
    (document.getElementById('pt-cliente') as HTMLInputElement).value = id;
    (document.getElementById('pt-cliente-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('pt-cliente-res'); if (ul) ul.innerHTML = '';
    const e = document.getElementById('pt-email') as HTMLInputElement;
    if (!e.value) {
      const { data } = await API.get<any[]>('contactos', { select: 'nombre,email', cliente_id: `eq.${id}`, email: 'not.is.null', order: 'favorito.desc', limit: '1' });
      if (data?.[0]?.email) { e.value = data[0].email; (document.getElementById('pt-nombre') as HTMLInputElement).value ||= data[0].nombre ?? ''; }
    }
  },
  ptTipo(t: string) { const l = document.getElementById('pt-cliente-l'); if (l) l.hidden = t === 'gestoria'; },
  async ptInvitar() {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
    const tipo = v('pt-tipo') || 'cliente';
    if (tipo === 'cliente' && !v('pt-cliente')) { toast('Elige el cliente de la lista', 'error'); return; }
    const r = await API.post('portal_accesos', { tipo, cliente_id: tipo === 'cliente' ? v('pt-cliente') : null, email: v('pt-email').toLowerCase(), nombre: v('pt-nombre') || null });
    if (r.error) toast(r.error.message.includes('duplicate') ? 'Ese correo ya tiene acceso' : `No se pudo: ${r.error.message}`, 'error');
    else { toast('Acceso dado: ahora puede pedir su enlace en el portal (o genéraselo tú)'); resolver(); }
  },
  async ptActivo(id: string, v: string) {
    if (v === '0' && !confirm('¿Revocar el acceso? Se cierran sus sesiones abiertas al momento.')) return;
    const r = await API.patch('portal_accesos', { id: `eq.${id}` }, { activo: v === '1' });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async ptEnlace(id: string) {
    const r = await llamarFuncion<{ url: string; caduca_min: number }>('portal', { accion: 'enlace_admin', acceso_id: id });
    const c = document.getElementById('pt-enlace');
    if (r.error || !r.data) { toast(`No se pudo: ${r.error}`, 'error'); return; }
    if (c) c.innerHTML = `<p class="aviso">Enlace de un solo uso (vale ${r.data.caduca_min} min). Mándaselo por WhatsApp:<br><input readonly value="${esc(r.data.url)}" aria-label="Enlace" id="pt-url"></p>`;
    (document.getElementById('pt-url') as HTMLInputElement | null)?.select();
    try { await navigator.clipboard.writeText(r.data.url); toast('Enlace copiado'); } catch { /* sin portapapeles */ }
  },
  async ptRevisada(id: string) {
    const r = await API.patch('portal_aceptaciones', { id: `eq.${id}` }, { revisada_at: new Date().toISOString() });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
});

async function contador(): Promise<Contador | null> {
  const [n, pend] = await Promise.all([API.contar('portal_accesos', { activo: 'eq.true' }), API.contar('portal_aceptaciones', { revisada_at: 'is.null' })]);
  if (n == null) return null;
  return { valor: n, subtitulo: pend ? `accesos · ${pend} presupuesto(s) aceptado(s) por pasar` : 'clientes con acceso', tono: pend ? 'mal' : 'neutro' };
}

export const moduloPortal: Modulo = {
  id: 'portal',
  titulo: 'Portal de clientes',
  grupo: 'Clientes',
  icono: '🌐',
  soloAdmin: true,
  explicacion: 'Quién de tus clientes (y la gestoría) puede entrar en su área (sus tickets, presupuestos, facturas, mantenimiento y equipos), qué ha hecho allí y los presupuestos que han aceptado desde el portal y falta pasar a la app.',
  pintar,
  contador,
};
