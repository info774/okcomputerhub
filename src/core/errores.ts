// Los últimos errores de JavaScript y la pantalla de antes (paridad bloque 6,
// ui/errores.js de la app): Feedback los adjunta solos al contar un fallo, así
// quien lo arregla no tiene que preguntar «¿qué salía?». Solo en memoria (y en
// la sesión del navegador, para sobrevivir a una recarga); nada sale de aquí
// salvo en el feedback que alguien manda.
const MAX = 10;
export interface ErrorJs { ts: string; mensaje: string; origen?: string; pila?: string; ruta: string }

let errores: ErrorJs[] = [];
try { errores = JSON.parse(sessionStorage.getItem('hub_errores') ?? '[]'); } catch { errores = []; }

function apuntar(mensaje: string, origen?: string, pila?: string) {
  if (!mensaje || /ResizeObserver loop/.test(mensaje)) return;
  errores = [{ ts: new Date().toISOString(), mensaje: mensaje.slice(0, 300), origen: origen?.slice(0, 200), pila: pila?.slice(0, 800), ruta: location.hash }, ...errores].slice(0, MAX);
  try { sessionStorage.setItem('hub_errores', JSON.stringify(errores)); } catch { /* sin almacenamiento */ }
}

window.addEventListener('error', e => apuntar(e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined, (e.error as Error | undefined)?.stack));
window.addEventListener('unhandledrejection', e => {
  const r = e.reason as Error | string | undefined;
  apuntar(typeof r === 'string' ? r : r?.message ?? 'Promesa rechazada', undefined, typeof r === 'object' ? r?.stack : undefined);
});

export const ultimosErrores = () => [...errores];

// La pantalla en la que estaba antes de abrir Feedback (de eso suele tratar).
let _anterior = '', _actual = location.hash;
window.addEventListener('hashchange', () => { if (!_actual.startsWith('#/feedback')) _anterior = _actual; _actual = location.hash; });
export const rutaAnterior = () => (_actual.startsWith('#/feedback') ? _anterior : _actual);
