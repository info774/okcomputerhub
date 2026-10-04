// Vuelta de la página de pago de Stripe (mandato.html de la app). Es solo un
// acuse para el cliente: el pago NO se da por bueno porque el navegador llegue
// aquí (cualquiera puede abrir esta URL); lo confirma el webhook de Stripe.
// Stripe vuelve con ?estado=ok o ?estado=cancelado; fallido = el banco o la
// tarjeta lo rechazaron.
import '../portal/portal.css';
import './contrato.css';

const estado = new URLSearchParams(location.search).get('estado') ?? 'ok';
const VISTAS: Record<string, [string, string, string, string]> = {
  ok: ['✓', 'bien', 'Datos de pago registrados', 'Ya tenemos tu medio de pago para la cuota de mantenimiento. Si has elegido domiciliación SEPA, el banco confirma el primer recibo en unos días. A partir de ahora las cuotas se cargarán automáticamente con el mismo método y recibirás cada factura por correo. Gracias por confiar en Ok Computer Tenerife.'],
  fallido: ['✕', 'mal', 'El pago no se ha completado', 'El banco o la tarjeta han rechazado el pago y no se ha cobrado nada. Tu contrato sigue firmado y en vigor: vuelve a abrir el enlace para intentarlo con otro método, o llámanos al 922 71 73 90.'],
  cancelado: ['!', 'aviso', 'Pago no completado', 'No se ha guardado ningún dato de pago ni se ha cobrado nada. Tu contrato sigue firmado y en vigor: puedes pagar la cuota cuando quieras con el mismo enlace, o llamándonos al 922 71 73 90.'],
};
const [ico, tono, titulo, texto] = VISTAS[estado] ?? VISTAS.ok;
const raiz = document.getElementById('mandato')!;
raiz.innerHTML = `<header class="po-cab"><span class="po-marca">Ok Computer Tenerife</span></header>
  <main><div class="po-tarjeta ct-centro"><div class="ct-ico ${tono}" aria-hidden="true">${ico}</div><h1></h1><p></p></div></main>`;
raiz.querySelector('h1')!.textContent = titulo;
raiz.querySelector('.ct-centro p')!.textContent = texto;
