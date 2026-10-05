// Firma del contrato de mantenimiento (firma.html de la app): página pública,
// sin sesión; la autoriza el token del enlace (contrato.html?token=…). Leer el
// documento entero, escribir el nombre, firmar con el dedo o el ratón y
// aceptar; tras firmar, si la función ofrece el pago de la primera cuota
// (tarjeta o SEPA por Stripe, cuando esté conectado), se ofrece aquí mismo.
import '../portal/portal.css';
import './contrato.css';
import { ico, type IconoLinea } from '../shell/linea';
import { FUNCIONES_URL, SUPABASE_ANON_KEY } from '../core/config';
import { esc } from '../ui/dom';

interface Pago { metodos?: string[]; importe?: number; importe_neto?: number; importe_mes?: number; meses?: number; impuesto_pct?: number;
  frecuencia?: string; plan?: string; sede?: string; ya_domiciliada?: boolean }

const raiz = document.getElementById('contrato')!;
const token = new URLSearchParams(location.search).get('token') ?? '';
const CAB = '<header class="po-cab"><span class="po-marca">Ok Computer Tenerife</span><span class="po-nota">Firma de contrato de mantenimiento</span></header>';
const PIE = '<p class="po-nota ct-pie">Firma electrónica · Se registran fecha, hora y datos técnicos como prueba de la firma.</p>';

async function llamar(cuerpo: Record<string, unknown>) {
  const r = await fetch(`${FUNCIONES_URL}/firma-contrato`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ token, ...cuerpo }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? 'No se pudo'), { status: r.status });
  return j;
}

function centrado(ico: string, tono: 'bien' | 'mal' | 'aviso', titulo: string, texto: string) {
  raiz.innerHTML = `${CAB}<main><div class="po-tarjeta ct-centro"><div class="ct-ico ${tono}" aria-hidden="true">${ico}</div><h1>${esc(titulo)}</h1><p>${esc(texto)}</p></div>${PIE}</main>`;
}

const euros = (n: number) => Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const METODO: Record<string, { titulo: string; sub: string; ico: IconoLinea }> = {
  card: { titulo: 'Pagar con tarjeta', sub: 'Se cobra en cuanto la registras. Las cuotas siguientes se cargan en la misma tarjeta.', ico: 'tarjeta' },
  sepa: { titulo: 'Domiciliar por SEPA', sub: 'Introduces tu IBAN y firmas el mandato. El recibo se confirma en unos días.', ico: 'banco' },
};

// Segundo paso, con el contrato firmado: pagar la primera cuota. «Ahora no» no
// rechaza nada (la firma ya está guardada), así que se despide igual de bien.
function vistaPago(p: Pago, titulo = '¡Contrato firmado!') {
  const metodos = (p.metodos ?? ['card', 'sepa']).filter(m => METODO[m]);
  const meses = Number(p.meses) || 1;
  const desglose = p.impuesto_pct ? `${euros(p.importe_neto ?? 0)} + ${p.impuesto_pct} % de impuestos = <strong>${euros(p.importe ?? 0)}</strong>` : `<strong>${euros(p.importe ?? 0)}</strong>`;
  const porMeses = meses > 1 && p.importe_mes ? ` (${euros(p.importe_mes)}/mes × ${meses} meses)` : '';
  raiz.innerHTML = `${CAB}<main><div class="po-tarjeta ct-centro"><div class="ct-ico bien" aria-hidden="true">✓</div><h1>${esc(titulo)}</h1>
    <p>Ya solo queda un paso: elige cómo quieres pagar la cuota de mantenimiento ${p.plan ? `<strong>${esc(p.plan)}</strong>` : ''}${p.sede ? ` de ${esc(p.sede)}` : ''}.
      Primera cuota (${esc((p.frecuencia ?? 'Mensual').toLowerCase())}): ${desglose}${porMeses}.</p>
    <p class="po-nota">Los datos de pago se introducen en la página segura de Stripe: nosotros no vemos ni guardamos tu tarjeta ni tu IBAN.</p>
    <div class="ct-metodos">${metodos.map(m => `<button class="po-btn ct-metodo" data-metodo="${m}"><span aria-hidden="true">${ico(METODO[m].ico)}</span>
      <span><strong>${METODO[m].titulo}</strong><small>${METODO[m].sub}</small></span></button>`).join('')}
      <button class="po-btn sec" id="ct-luego">Ahora no</button></div>
    <p class="po-mal" id="ct-pago-err" role="alert"></p></div>${PIE}</main>`;
  raiz.querySelectorAll<HTMLButtonElement>('.ct-metodo').forEach(b => b.addEventListener('click', () => pagar(b.dataset.metodo!)));
  document.getElementById('ct-luego')!.addEventListener('click', () => centrado('✓', 'bien', '¡Contrato firmado!',
    'Hemos registrado tu firma correctamente. Te enviaremos el enlace para pagar la cuota. Gracias por confiar en Ok Computer Tenerife.'));
}

async function pagar(metodo: string) {
  const botones = [...raiz.querySelectorAll<HTMLButtonElement>('.ct-metodos button')];
  const err = document.getElementById('ct-pago-err')!;
  err.textContent = '';
  botones.forEach(b => { b.disabled = true; });
  try {
    const d = await llamar({ accion: 'pagar', metodo });
    if (d.url && /^https:\/\//.test(d.url)) { location.href = d.url; return; }
    centrado('✓', 'bien', d.ya_domiciliada ? 'Cuota ya domiciliada' : 'Cuota domiciliada', d.ya_domiciliada
      ? 'Esta cuota ya se está cobrando con el método de pago que nos diste. No hay que hacer nada más.'
      : `${d.mensaje || 'Hemos cobrado la primera cuota con tu método de pago habitual.'} Gracias por confiar en Ok Computer Tenerife.`);
  } catch (e) {
    err.textContent = (e as Error).message || 'No se pudo preparar el pago. Inténtalo de nuevo.';
    botones.forEach(b => { b.disabled = false; });
  }
}

// Lienzo de firma (ratón, dedo o lápiz), con la densidad de la pantalla.
function lienzo(c: HTMLCanvasElement, alCambiar: () => void) {
  const ctx = c.getContext('2d')!;
  let hay = false, dibujando = false;
  const ajustar = () => {
    const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const antes = hay ? c.toDataURL() : null;
    c.width = r.width * dpr; c.height = r.height * dpr; ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    if (antes) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = antes; }
  };
  ajustar();
  addEventListener('resize', () => setTimeout(ajustar, 60));
  const punto = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  c.addEventListener('pointerdown', e => { e.preventDefault(); dibujando = true; c.setPointerCapture(e.pointerId); const [x, y] = punto(e); ctx.beginPath(); ctx.moveTo(x, y); });
  c.addEventListener('pointermove', e => {
    if (!dibujando) return;
    const [x, y] = punto(e); ctx.lineTo(x, y); ctx.stroke();
    if (!hay) { hay = true; alCambiar(); }
  });
  c.addEventListener('pointerup', () => { dibujando = false; });
  return { hay: () => hay, borrar: () => { ctx.clearRect(0, 0, c.width, c.height); hay = false; alCambiar(); } };
}

function vistaFirma(c: { plan_nombre: string; cliente_nombre: string | null; cuerpo_html: string }) {
  raiz.innerHTML = `${CAB}<main>
    <article class="po-tarjeta"><p class="ct-estado"><span class="po-chip aviso">Pendiente de firma</span> <strong>Contrato de Mantenimiento ${esc(c.plan_nombre)}</strong>
      ${c.cliente_nombre ? `<span class="po-nota">· ${esc(c.cliente_nombre)}</span>` : ''}</p>
      <div class="ct-doc" id="ct-doc" tabindex="0" aria-label="Texto del contrato"></div></article>
    <form class="po-tarjeta" id="ct-form"><h2>Firma del contrato</h2>
      <p class="po-nota">Lee el contrato completo. Para formalizarlo, escribe tu nombre, dibuja tu firma y marca la casilla de aceptación.</p>
      <label>Nombre y apellidos de quien firma <input id="ct-nombre" autocomplete="name" placeholder="Ej. María Hernández" minlength="3" required></label>
      <p class="po-nota">Firma aquí con el dedo o el ratón:</p>
      <canvas id="ct-lienzo" class="fr-lienzo" aria-label="Espacio para firmar"></canvas>
      <div class="po-acciones"><button type="button" class="po-btn sec" id="ct-borrar">Borrar firma</button></div>
      <label class="fr-acepto"><input type="checkbox" id="ct-acepta"> He leído y acepto las condiciones del presente contrato de mantenimiento y consiento su firma electrónica.</label>
      <button class="po-btn" type="submit" id="ct-firmar" disabled>Firmar contrato</button>
      <p class="po-mal" id="ct-err" role="alert"></p></form>${PIE}</main>`;
  // El documento lo compone la app o el hub (escapado al componerlo): se pinta tal cual.
  document.getElementById('ct-doc')!.innerHTML = c.cuerpo_html || '';
  const nombre = document.getElementById('ct-nombre') as HTMLInputElement;
  const acepta = document.getElementById('ct-acepta') as HTMLInputElement;
  const boton = document.getElementById('ct-firmar') as HTMLButtonElement;
  const actualizar = () => { boton.disabled = !(l.hay() && acepta.checked && nombre.value.trim().length >= 3); };
  const canvas = document.getElementById('ct-lienzo') as HTMLCanvasElement;
  const l = lienzo(canvas, () => actualizar());
  nombre.addEventListener('input', actualizar);
  acepta.addEventListener('change', actualizar);
  document.getElementById('ct-borrar')!.addEventListener('click', () => l.borrar());
  document.getElementById('ct-form')!.addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('ct-err')!;
    err.textContent = '';
    boton.disabled = true; boton.textContent = 'Firmando…';
    try {
      const d = await llamar({ accion: 'firmar', firmante_nombre: nombre.value.trim(), acepta: acepta.checked, firma_img: canvas.toDataURL('image/png') });
      if (d.pago && !d.pago.ya_domiciliada && d.pago.importe) { vistaPago(d.pago); return; }
      centrado('✓', 'bien', '¡Contrato firmado!', 'Hemos registrado tu firma correctamente. Recibirás una copia del contrato. Gracias por confiar en Ok Computer Tenerife.');
    } catch (x) {
      err.textContent = (x as Error).message || 'No se pudo firmar. Inténtalo de nuevo.';
      boton.textContent = 'Firmar contrato'; actualizar();
    }
  });
}

async function arrancar() {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) { centrado('!', 'mal', 'Enlace no válido', 'Este enlace de firma no es correcto. Pide uno nuevo a Ok Computer Tenerife.'); return; }
  let d: { contrato: { estado: string; plan_nombre: string; cliente_nombre: string | null; cuerpo_html: string; firmante_nombre: string | null; firmado_at: string | null }; pago: Pago | null };
  try { d = await llamar({ accion: 'ver' }); } catch (e) {
    if ((e as { status?: number }).status === 404) centrado('?', 'mal', 'Contrato no encontrado', 'No hemos encontrado ningún contrato con este enlace.');
    else centrado('!', 'mal', 'Error de conexión', 'No hemos podido cargar el contrato. Revisa tu conexión e inténtalo de nuevo.');
    return;
  }
  const c = d.contrato;
  // Firmado con la cuota sin pagar (cerró la página antes): se vuelve a ofrecer.
  if (c.estado === 'firmado' && d.pago && !d.pago.ya_domiciliada && d.pago.importe) { vistaPago(d.pago, 'Contrato firmado'); return; }
  if (c.estado === 'firmado') {
    const f = c.firmado_at ? new Date(c.firmado_at).toLocaleString('es-ES') : '';
    centrado('✓', 'bien', 'Contrato firmado', `Este contrato ya fue firmado${c.firmante_nombre ? ` por ${c.firmante_nombre}` : ''}${f ? ` el ${f}` : ''}. Gracias.`);
    return;
  }
  if (c.estado === 'anulado') { centrado('✕', 'mal', 'Contrato anulado', 'Este contrato ha sido anulado. Contacta con Ok Computer Tenerife.'); return; }
  vistaFirma(c);
}
arrancar();
