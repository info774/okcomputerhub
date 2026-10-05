// Aviso de versión nueva (paridad bloque 6, ui/version-check.js de la app): el
// deploy deja dist/version.json con el SHA (vite.config.ts); el hub guarda con
// cuál arrancó y lo vuelve a leer cada 5 min y al volver a primer plano. Si
// cambió, una barra «Nueva versión · Recargar» (que antes pide al service
// worker que se ponga al día). Sin version.json (en local) no hace nada.
import { ico } from './linea';

let _arranque: string | null = null;
let _avisado = false;

async function leer(): Promise<string | null> {
  try {
    const r = await fetch('/version.json', { cache: 'no-store' });
    return r.ok ? ((await r.json())?.build ?? null) : null;
  } catch { return null; }
}

/** El SHA con el que arrancó esta pestaña (lo lleva el aviso a Claude Code). */
export const buildActual = () => _arranque;

function avisar() {
  if (_avisado) return;
  _avisado = true;
  const b = document.createElement('div');
  b.id = 'version-nueva';
  b.className = 'version-nueva';
  b.setAttribute('role', 'status');
  b.innerHTML = `<span>${ico('actualizar')} Hay una versión nueva del hub</span><button type="button" class="btn" data-action="recargarVersion">Recargar</button>`;
  document.body.appendChild(b);
}

async function comprobar() {
  if (_avisado || !_arranque) return;
  const ahora = await leer();
  if (ahora && ahora !== _arranque) avisar();
}

export async function recargarVersion() {
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* sin SW */ }
  location.reload();
}

export async function iniciarVersion() {
  _arranque = await leer();
  if (!_arranque) return;
  setInterval(comprobar, 5 * 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void comprobar(); });
  window.addEventListener('focus', () => void comprobar());
}
