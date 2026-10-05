// Dictar: grabar con MediaRecorder y pasarlo a texto en la función `comandas`
// (acción `transcribir`, Groq Whisper).
//   · grabarYTranscribir(avisos): graba hasta que se llame a pararGrabacion() y
//     devuelve el texto. Lo usa la voz de Oki de la portada.
//   · alternarDictado(boton, campoId): el botón de dictar de un formulario
//     (ui/dictado.js de la app): un clic graba, otro para, y el texto se AÑADE
//     al campo. Lo usa la nota de voz del Tablero.
import { llamarFuncion } from '../core/funciones';
import { toast } from './dom';
import { ico } from '../shell/linea';

let _grabadora: MediaRecorder | null = null;

export const puedeDictar = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
export const grabando = () => _grabadora?.state === 'recording';
export function pararGrabacion() { if (grabando()) _grabadora!.stop(); }

const aBase64 = (b: Blob) => new Promise<string>((ok, mal) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(',')[1] ?? ''); f.onerror = mal; f.readAsDataURL(b); });

export interface Avisos { empieza?(): void; pasando?(): void }

export async function grabarYTranscribir(avisos: Avisos = {}): Promise<{ texto: string | null; error: string | null }> {
  if (!puedeDictar()) return { texto: null, error: 'Este navegador no deja grabar audio' };
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return { texto: null, error: 'No hay permiso para el micrófono: actívalo en el navegador' }; }
  const trozos: Blob[] = [];
  const g = new MediaRecorder(stream);
  _grabadora = g;
  const parado = new Promise<void>(ok => { g.onstop = () => ok(); });
  g.ondataavailable = e => { if (e.data.size) trozos.push(e.data); };
  g.start();
  avisos.empieza?.();
  await parado;
  stream.getTracks().forEach(t => t.stop());
  _grabadora = null;
  const blob = new Blob(trozos, { type: g.mimeType || 'audio/webm' });
  if (blob.size < 1000) return { texto: null, error: 'No se ha grabado nada' };
  avisos.pasando?.();
  const r = await llamarFuncion<{ texto: string }>('comandas', { accion: 'transcribir', audio: await aBase64(blob), mime: blob.type });
  if (r.error) return { texto: null, error: `No se pudo pasar a texto: ${r.error}` };
  const texto = r.data?.texto?.trim();
  return texto ? { texto, error: null } : { texto: null, error: 'No se entendió nada' };
}

export async function alternarDictado(boton: HTMLElement | null, campoId: string) {
  if (grabando()) { pararGrabacion(); return; }
  const html0 = boton?.innerHTML ?? '';
  const r = await grabarYTranscribir({
    empieza: () => { if (boton) { boton.innerHTML = `${ico('parar')} Parar`; boton.setAttribute('aria-pressed', 'true'); } },
    pasando: () => { if (boton) boton.textContent = '… pasando a texto'; },
  });
  if (boton) { boton.innerHTML = html0; boton.setAttribute('aria-pressed', 'false'); }
  if (!r.texto) { toast(r.error ?? 'No se entendió nada', 'error'); return; }
  const campo = document.getElementById(campoId) as HTMLTextAreaElement | HTMLInputElement | null;
  if (campo) { campo.value = campo.value.trim() ? `${campo.value.trimEnd()}\n${r.texto}` : r.texto; campo.dispatchEvent(new Event('input', { bubbles: true })); }
}
