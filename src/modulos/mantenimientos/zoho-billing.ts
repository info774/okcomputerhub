// Las suscripciones de Zoho Billing de un cliente, en la pestaña Sedes de su
// ficha (fetchZohoBillingSubscriptions / asignarSuscripcionALocal de
// clientes.js de la app): se buscan por su id de Zoho Books y cada una se puede
// VINCULAR a una de sus sedes, que queda con el plan, el estado, la deuda y la
// próxima cuota de Zoho. Buscar vale ya (solo lee Zoho); vincular, solo un
// admin y con el corte (antes se hace en la app). Función `zoho-cartera`.
// Prefijo de ids: czb-.
import { registrarAcciones } from '../../core/dispatcher';
import { llamarFuncion } from '../../core/funciones';
import { resolver } from '../../core/router';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';

interface Sub { subscription_id: string; plan_name: string; status: string; status_label: string; amount: number | null; next_billing_at: string | null; url: string }
const TONO: Record<string, string> = { live: 'bien', active: 'bien', trial: '', paused: 'aviso', cancelled: 'mal', expired: 'mal', future: '', non_renewing: 'aviso' };
let _sedes: { id: string; nombre: string }[] = [];

export function bloqueZohoBilling(zohoId: string, sedes: { id: string; nombre: string }[]): string {
  _sedes = sedes;
  return `<section class="tarjeta" id="czb"><h3>Zoho Billing</h3>
    <p class="nota">Las suscripciones de la cartera vieja de este cliente: cada una se vincula a la sede que paga.</p>
    <button class="btn secundario" data-action="czbBuscar" data-p0="${esc(zohoId)}">${ico('descargar')} Buscar sus suscripciones en Zoho Billing</button>
    <div id="czb-lista"></div></section>`;
}

registrarAcciones({
  async czbBuscar(zohoId: string) {
    const caja = document.getElementById('czb-lista'); if (!caja) return;
    caja.innerHTML = '<p class="cargando">Preguntando a Zoho…</p>';
    const r = await llamarFuncion<{ subscriptions: Sub[]; puede_vincular: boolean }>('zoho-cartera', { accion: 'listar', zoho_customer_id: zohoId });
    if (r.error || !r.data) { caja.innerHTML = `<p class="aviso mal">${esc(r.error ?? 'Zoho no contestó')}</p>`; return; }
    const { subscriptions: subs, puede_vincular: puede } = r.data;
    const opciones = `<option value="">— Asignar a la sede —</option>${_sedes.map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join('')}`;
    caja.innerHTML = subs.length ? `<ul class="mdo-lista" id="czb-subs">${subs.map(s => `<li data-sub="${esc(s.subscription_id)}">
        <div class="mdo-cab"><strong>${esc(s.plan_name || 'Sin plan')}</strong> <span class="chip ${TONO[s.status] ?? ''}">${esc(s.status_label)}</span>
          <small class="nota">${s.amount != null ? `${esc(String(s.amount))} € · ` : ''}${s.next_billing_at ? `próx. renovación ${esc(s.next_billing_at)} · ` : ''}<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.subscription_id)} ${ico('externo')}</a></small></div>
        ${puede ? `<div class="acciones"><select id="czb-sede-${esc(s.subscription_id)}" aria-label="Sede">${opciones}</select>
          <button class="btn secundario" data-action="czbVincular" data-p0="${esc(s.subscription_id)}">Vincular</button></div>` : ''}</li>`).join('')}</ul>
        ${puede ? '' : '<p class="nota">Vincular una suscripción a una sede se sigue haciendo en la app hasta el cambio.</p>'}`
      : '<p class="vacio">No hay suscripciones en Zoho Billing para este cliente.</p>';
  },
  async czbVincular(subId: string) {
    const sede = (document.getElementById(`czb-sede-${subId}`) as HTMLSelectElement | null)?.value;
    if (!sede) { toast('Elige antes la sede', 'error'); return; }
    const r = await llamarFuncion<{ mensaje?: string; estado_pago?: string }>('zoho-cartera', { accion: 'vincular', local_id: sede, subscription_id: subId });
    if (r.error || !r.data) { toast(r.error ?? 'No se pudo vincular', 'error'); return; }
    toast(r.data.mensaje ?? `Vinculada ✓ ${r.data.estado_pago ?? ''}`);
    resolver();
  },
});
