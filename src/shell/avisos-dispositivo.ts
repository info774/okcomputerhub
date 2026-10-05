// «Avisos en este dispositivo» e «Instalar la app» (paridad bloque 6: las
// notificaciones y la instalación de Configuración de la app). Dos sitios:
//   · el pie del menú (cualquiera, también un técnico): un botón que dice cómo
//     está y lo activa; sin ids, porque convive con la tarjeta;
//   · la tarjeta de Configuración (`tarjetaAvisos`, prefijo av-) con Probar,
//     Desactivar e Instalar.
import { registrarAcciones } from '../core/dispatcher';
import { activarPush, desactivarPush, estadoPush, probarPush, type EstadoPush } from '../core/push';
import { toast } from '../ui/dom';

const TEXTO: Record<EstadoPush, string> = {
  'no-soportado': 'Este navegador no admite avisos',
  denegado: 'Avisos bloqueados en este navegador',
  activo: 'Avisos activados en este dispositivo',
  inactivo: 'Activar avisos en este dispositivo',
};

// Instalar como app (Chrome/Edge/Android): el navegador ofrece el evento una vez.
let _instalar: (Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _instalar = e as typeof _instalar; void pintarAvisos(); });
window.addEventListener('appinstalled', () => { _instalar = null; void pintarAvisos(); });
const instalada = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const controlAvisos = () => `<button type="button" class="menu-avisos" data-action="pushMenu" data-estado="inactivo">🔔 <span>${TEXTO.inactivo}</span></button>`;

export const tarjetaAvisos = () => `<section class="tarjeta" id="av-tarjeta"><h3>🔔 Avisos y app en este dispositivo</h3>
  <p class="nota">Comandas que te pasan, mensajes del chat y, cuando la agenda sea del hub, los trabajos que empiezan en una hora. Es por dispositivo: actívalo en cada móvil u ordenador en el que quieras enterarte.</p>
  <p id="av-estado" class="cargando">Mirando…</p>
  <div class="acciones" id="av-botones"></div></section>`;

/** Repinta el botón del menú y, si está en pantalla, la tarjeta. */
export async function pintarAvisos() {
  const e = await estadoPush();
  document.querySelectorAll<HTMLButtonElement>('.menu-avisos').forEach(b => {
    b.dataset.estado = e;
    b.hidden = e === 'no-soportado';
    b.querySelector('span')!.textContent = TEXTO[e];
  });
  const est = document.getElementById('av-estado'), bot = document.getElementById('av-botones');
  if (!est || !bot) return;
  est.className = e === 'activo' ? 'chip bien' : e === 'inactivo' ? '' : 'aviso';
  est.textContent = e === 'denegado' ? `${TEXTO[e]}: se activan en el candado de la barra de direcciones (Permisos → Notificaciones).` : TEXTO[e];
  bot.innerHTML = (e === 'activo'
    ? '<button class="btn" data-action="pushProbar">Mandarme una prueba</button><button class="btn secundario" data-action="pushDesactivar">Desactivar aquí</button>'
    : e === 'inactivo' ? '<button class="btn" data-action="pushActivar">Activar los avisos</button>' : '')
    + (_instalar && !instalada() ? '<button class="btn secundario" data-action="instalarApp">📲 Instalar el hub como app</button>' : '')
    + (instalada() ? '<span class="chip">Instalado como app</span>' : '');
}

async function activar() {
  const err = await activarPush();
  toast(err ?? 'Avisos activados en este dispositivo', err ? 'error' : 'info');
  await pintarAvisos();
}

registrarAcciones({
  async pushMenu() {
    const e = await estadoPush();
    if (e === 'inactivo') return activar();
    if (e === 'activo') { location.hash = '#/configuracion'; toast('Ya los tienes activados en este dispositivo'); return; }
    toast(TEXTO[e], 'error');
  },
  pushActivar: activar,
  async pushDesactivar() { await desactivarPush(); toast('Este dispositivo ya no recibirá avisos'); await pintarAvisos(); },
  async pushProbar() {
    const r = await probarPush();
    if (r.error) toast(`No se pudo: ${r.error}`, 'error');
    else if (!r.data?.enviados) toast(`No llegó a ningún dispositivo${r.data?.detalle ? `: ${r.data.detalle}` : ''}`, 'error');
    else toast(`Enviada a ${r.data.enviados} dispositivo${r.data.enviados === 1 ? '' : 's'}`);
  },
  async instalarApp() {
    if (!_instalar) { toast('Usa «Instalar» o «Añadir a pantalla de inicio» del menú del navegador'); return; }
    await _instalar.prompt();
    _instalar = null;
    await pintarAvisos();
  },
});
