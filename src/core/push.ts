// Avisos en este dispositivo (paridad bloque 6, integrations/push.js de la
// app; solo Web Push: la APK nativa queda para el corte final). El navegador
// se suscribe con la clave VAPID pública del hub y la función `push` guarda la
// suscripción a nombre de quien tiene la sesión (al entrar se vuelve a mandar:
// si el móvil cambió de persona, cambia de dueño). Lo que llega lo enseña el
// service worker (public/sw.js); tocarlo trae aquí la pantalla del aviso.
import { VAPID_PUBLIC_KEY } from './config';
import { llamarFuncion } from './funciones';

export type EstadoPush = 'no-soportado' | 'denegado' | 'activo' | 'inactivo';

export const pushSoportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const claveBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

async function registro(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSoportado()) return null;
  try { return (await navigator.serviceWorker.getRegistration()) ?? null; } catch { return null; }
}

async function suscripcionActual(): Promise<PushSubscription | null> {
  try { return (await (await registro())?.pushManager.getSubscription()) ?? null; } catch { return null; }
}

export async function estadoPush(): Promise<EstadoPush> {
  if (!pushSoportado()) return 'no-soportado';
  if (Notification.permission === 'denied') return 'denegado';
  return (await suscripcionActual()) && Notification.permission === 'granted' ? 'activo' : 'inactivo';
}

const mandar = (s: PushSubscription) => {
  const j = s.toJSON();
  return llamarFuncion('push', { accion: 'registrar', endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth });
};

/** Pide permiso, suscribe este navegador y lo apunta en el hub. Devuelve el error para la persona, o null. */
export async function activarPush(): Promise<string | null> {
  if (!pushSoportado()) return 'Este navegador no admite avisos. En el iPhone, primero «Añadir a pantalla de inicio» y ábrelo desde allí.';
  const reg = await registro();
  if (!reg) return 'El hub no está instalado en este navegador todavía: recarga la página y vuelve a probar.';
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return 'Los avisos están bloqueados para el hub: actívalos en el candado de la barra de direcciones (Permisos → Notificaciones).';
  try {
    const s = (await reg.pushManager.getSubscription())
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveBytes(VAPID_PUBLIC_KEY) });
    const r = await mandar(s);
    return r.error ? `No se pudo apuntar este dispositivo: ${r.error}` : null;
  } catch (e) {
    return `El navegador no dejó suscribirse: ${(e as Error).message}`;
  }
}

export async function desactivarPush(): Promise<void> {
  const s = await suscripcionActual();
  if (!s) return;
  await llamarFuncion('push', { accion: 'quitar', endpoint: s.endpoint });
  try { await s.unsubscribe(); } catch { /* ya no estaba */ }
}

export const probarPush = () => llamarFuncion<{ enviados: number; errores: number; borradas: number; detalle?: string }>('push', { accion: 'probar' });

/** Al entrar: si este navegador ya avisaba, se vuelve a apuntar a quien tiene la sesión ahora. */
export async function refrescarPush(): Promise<void> {
  if (!pushSoportado() || Notification.permission !== 'granted') return;
  const s = await suscripcionActual();
  if (s) await mandar(s);
}

/** El service worker pide ir a una pantalla (tocaron un aviso con el hub ya abierto). */
export function escucharAvisos() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.tipo !== 'hub-ir' || typeof e.data.url !== 'string') return;
    const hash = new URL(e.data.url, location.origin).hash;
    if (hash) location.hash = hash;
  });
}
