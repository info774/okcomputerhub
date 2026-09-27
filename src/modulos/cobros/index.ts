// Cobros (fase 4, solo admins): #/cobros. Los recordatorios de facturas
// vencidas que el hub PREPARA cada mañana (hub.preparar_recordatorios, a los 7,
// 21 y 45 días) y que una persona manda con un clic desde su WhatsApp o su
// correo: el hub no escribe a ningún cliente por su cuenta. Además, las
// vencidas que aún no llegan al primer aviso y los cobros de mantenimiento
// torcidos de la app. Prefijo de ids: co-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { esc, toast, hace, fechaHora } from '../../ui/dom';
import { eur, telWhatsApp, enApp } from '../ventas/datos';

interface Rec { id: string; invoice_id: string; numero: string; cliente_zoho_id: string | null; cliente_nombre: string | null; saldo: number;
  vence: string; nivel: number; estado: string; texto: string; canal: string | null; enviado_at: string | null; created_at: string }

const ZOHO = 'https://books.zoho.eu/app/20107733530#/invoices/';
const hoy = () => new Date().toLocaleDateString('sv-SE');
const dias = (f: string) => Math.round((Date.parse(hoy()) - Date.parse(f)) / 86400000);
let _recs: Rec[] = [];

async function pintar(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [recs, vencidas, mant, sync] = await Promise.all([
    API.get<Rec[]>('cobros_recordatorios', { select: '*', or: `(estado.eq.pendiente,enviado_at.gt.${new Date(Date.now() - 30 * 86400000).toISOString()})`, order: 'estado.desc,saldo.desc' }),
    API.get<any[]>('zoho_facturas', { select: 'invoice_id,numero,cliente_nombre,cliente_zoho_id,saldo,vence', saldo: 'gt.0', vence: `lt.${hoy()}`, estado: 'not.in.(void,draft,paid)', order: 'vence' }),
    API.get<any[]>('locales', { select: 'id,nombre,cliente_id,estado_pago,importe_mantenimiento,stripe_ultimo_error', activo: 'neq.false',
      or: '(estado_pago.in.("Pendiente de pago","Último aviso","No paga"),stripe_ultimo_error.not.is.null)', order: 'nombre' }),
    API.single<any>('sync_estado', { select: 'ultima_ok', clave: 'eq.zoho' }),
  ]);
  if (recs.error) { el.innerHTML = `<p class="aviso mal">${esc(recs.error.message)}</p>`; return; }
  _recs = recs.data ?? [];
  const zohoIds = [...new Set([..._recs.map(r => r.cliente_zoho_id), ...(vencidas.data ?? []).map(f => f.cliente_zoho_id)].filter(Boolean))];
  const { data: cls } = zohoIds.length ? await API.get<any[]>('clientes', { select: 'id,nombre,telefono,email,zoho_id', zoho_id: `in.(${zohoIds.join(',')})` }) : { data: [] };
  const porZoho = new Map((cls ?? []).map(c => [c.zoho_id, c]));
  const pendientes = _recs.filter(r => r.estado === 'pendiente');
  const conRec = new Set(_recs.map(r => r.invoice_id));
  const sinRec = (vencidas.data ?? []).filter(f => !conRec.has(f.invoice_id));
  const totalVencido = (vencidas.data ?? []).reduce((s, f) => s + Number(f.saldo), 0);

  const tarjetaRec = (r: Rec) => {
    const c = r.cliente_zoho_id ? porZoho.get(r.cliente_zoho_id) : null;
    const wa = telWhatsApp(c?.telefono);
    const asunto = `Factura ${r.numero} pendiente de pago`;
    return `<article class="tarjeta co-rec" data-id="${esc(r.id)}">
      <div class="tarjeta-cab"><h3>${esc(r.cliente_nombre ?? '')} · <a href="${ZOHO}${esc(r.invoice_id)}" target="_blank" rel="noopener">${esc(r.numero)}</a></h3>
        <span><span class="chip ${r.nivel === 3 ? 'mal' : 'aviso'}">${r.nivel}.º aviso</span> <strong>${eur(r.saldo, 2)}</strong></span></div>
      <p class="nota">Venció el ${esc(r.vence)} (${dias(r.vence)} días)${c ? ` · <a href="#/clientes/${esc(c.id)}">ficha del cliente</a>` : ' · <span class="aviso">no se encuentra el cliente en la app</span>'}</p>
      <textarea id="co-texto-${esc(r.id)}" rows="4" data-on-change="coTexto:${esc(r.id)},$value" aria-label="Texto del recordatorio">${esc(r.texto)}</textarea>
      <div class="acciones">
        ${wa ? `<a class="btn" href="https://wa.me/${wa}?text=${encodeURIComponent(r.texto)}" target="_blank" rel="noopener" data-action="coAbierto" data-p0="${esc(r.id)}" data-p1="whatsapp">💬 WhatsApp</a>` : ''}
        ${c?.email ? `<a class="btn secundario" href="mailto:${esc(c.email)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(r.texto)}" data-action="coAbierto" data-p0="${esc(r.id)}" data-p1="email">✉️ Email</a>` : ''}
        ${c?.telefono ? `<a class="btn secundario" href="tel:${esc(c.telefono)}">📞 ${esc(c.telefono)}</a>` : ''}
        <button class="btn secundario" data-action="coCopiar" data-p0="${esc(r.id)}">Copiar texto</button>
        <button class="btn secundario" data-action="coEnviado" data-p0="${esc(r.id)}" data-p1="otro">Marcar enviado</button>
        <button class="btn peligro" data-action="coDescartar" data-p0="${esc(r.id)}">Descartar</button>
      </div></article>`;
  };

  el.innerHTML = `${sync.data?.ultima_ok ? '' : '<p class="aviso">Zoho Books aún no está conectado al hub: sin su copia no hay facturas que reclamar. <a href="#/datos">Conectarlo</a>.</p>'}
    <div class="di-cifras">
      <article class="tarjeta di-cifra ${totalVencido ? 'mal' : ''}"><h3>Vencido</h3><p class="di-valor">${eur(totalVencido)}</p><p class="nota">${vencidas.data?.length ?? 0} factura(s)</p></article>
      <article class="tarjeta di-cifra"><h3>Recordatorios listos</h3><p class="di-valor">${pendientes.length}</p><p class="nota">${eur(pendientes.reduce((s, r) => s + Number(r.saldo), 0))} por reclamar</p></article>
      <article class="tarjeta di-cifra"><h3>Mantenimiento</h3><p class="di-valor">${mant.data?.length ?? 0}</p><p class="nota">sedes con el cobro torcido (se gestiona en la app)</p></article>
    </div>
    <h2>Recordatorios listos para mandar</h2>
    <p class="nota">Se preparan solos cada mañana a los 7, 21 y 45 días del vencimiento. Revisa el texto, mándalo con tu WhatsApp o tu correo y márcalo como enviado.</p>
    ${pendientes.length ? pendientes.map(tarjetaRec).join('') : '<p class="vacio">✅ Nada que reclamar ahora mismo.</p>'}
    ${sinRec.length ? `<h2>Vencidas que aún no llegan al primer aviso</h2><div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Factura</th><th>Cliente</th><th>Pendiente</th><th>Venció</th></tr></thead>
      <tbody>${sinRec.map(f => `<tr><td><a href="${ZOHO}${esc(f.invoice_id)}" target="_blank" rel="noopener">${esc(f.numero)}</a></td><td>${esc(f.cliente_nombre ?? '')}</td>
        <td>${eur(f.saldo, 2)}</td><td>${esc(f.vence)} (${dias(f.vence)} d)</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${(mant.data ?? []).length ? `<h2>Mantenimiento con el cobro torcido</h2><p class="nota">Stripe y Zoho Billing los gestiona la <a href="${esc(enApp())}" target="_blank" rel="noopener">app actual ↗</a> (Mantenimientos → Cobros).</p>
      <div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Sede</th><th>Estado</th><th>Cuota</th></tr></thead>
      <tbody>${(mant.data ?? []).map(l => `<tr><td>${l.cliente_id ? `<a href="#/clientes/${esc(l.cliente_id)}/sedes">${esc(l.nombre)}</a>` : esc(l.nombre)}</td>
        <td>${esc(l.estado_pago ?? '')}${l.stripe_ultimo_error ? `<br><small class="mal">${esc(l.stripe_ultimo_error)}</small>` : ''}</td><td>${l.importe_mantenimiento ? eur(l.importe_mantenimiento, 2) : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${_recs.some(r => r.estado !== 'pendiente') ? `<h2>Enviados (30 días)</h2><ul class="di-ultimo">${_recs.filter(r => r.estado === 'enviado').map(r =>
      `<li><small class="nota" title="${esc(fechaHora(r.enviado_at))}">${esc(hace(r.enviado_at))}</small><span>${esc(r.numero)} · ${esc(r.cliente_nombre ?? '')} · ${r.nivel}.º aviso por ${esc(r.canal ?? '')}</span></li>`).join('')}</ul>` : ''}`;
}

async function marcar(id: string, cambios: Record<string, unknown>, msg: string) {
  const r = await API.patch('cobros_recordatorios', { id: `eq.${id}` }, cambios);
  if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast(msg); resolver(); }
}

registrarAcciones({
  async coTexto(id: string, texto: string) {
    const r = await API.patch('cobros_recordatorios', { id: `eq.${id}` }, { texto });
    if (r.error) toast(`No se guardó el texto: ${r.error.message}`, 'error');
  },
  // Abrir WhatsApp o el correo no es mandarlo: se pregunta al volver.
  coAbierto(id: string, canal: string) {
    window.setTimeout(() => {
      if (confirm('¿Lo has mandado? Si dices que sí, queda marcado como enviado.')) void marcar(id, { estado: 'enviado', canal, enviado_at: new Date().toISOString(), enviado_por: usuario()?.id }, 'Marcado como enviado');
    }, 1500);
  },
  async coCopiar(id: string) {
    const t = (document.getElementById(`co-texto-${id}`) as HTMLTextAreaElement | null)?.value ?? '';
    try { await navigator.clipboard.writeText(t); toast('Copiado'); } catch { toast('No se pudo copiar: selecciónalo a mano', 'error'); }
  },
  coEnviado(id: string, canal: string) { void marcar(id, { estado: 'enviado', canal, enviado_at: new Date().toISOString(), enviado_por: usuario()?.id }, 'Marcado como enviado'); },
  coDescartar(id: string) { if (confirm('¿Descartar este recordatorio? No se volverá a preparar este aviso para la factura.')) void marcar(id, { estado: 'descartado' }, 'Descartado'); },
});

async function contador(): Promise<Contador | null> {
  const n = await API.contar('cobros_recordatorios', { estado: 'eq.pendiente' });
  if (n == null) return null;
  return { valor: n, subtitulo: 'recordatorios de cobro listos', tono: n ? 'aviso' : 'bien' };
}

export const moduloCobros: Modulo = {
  id: 'cobros',
  titulo: 'Cobros',
  grupo: 'Clientes',
  icono: '💶',
  soloAdmin: true,
  explicacion: 'Facturas vencidas de Zoho y los recordatorios que el hub deja preparados (a los 7, 21 y 45 días). Nada sale solo hacia el cliente: se revisa el texto y se manda con un clic desde tu WhatsApp o tu correo.',
  pintar,
  contador,
};
