// Dictar dentro de un campo (ui/dictado.js de la app): un botón que graba con
// MediaRecorder, lo pasa a texto en la función `comandas` (acción
// `transcribir`, Groq Whisper) y AÑADE el texto al campo. Un segundo clic
// para la grabación. Lo usa la nota de voz del Tablero; vale para cualquier
// formulario: `alternarDictado(boton, 'id-del-campo')`.
import { llamarFuncion } from '../core/funciones';
import { toast } from './dom';

let _grabadora: MediaRecorder | null = null;

export const puedeDictar = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

const aBase64 = (b: Blob) => new Promise<string>((ok, mal) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(',')[1] ?? ''); f.onerror = mal; f.readAsDataURL(b); });

export async function alternarDictado(boton: HTMLElement | null, campoId: string) {
  if (_grabadora?.state === 'recording') { _grabadora.stop(); return; }
  if (!puedeDictar()) { toast('Este navegador no deja grabar audio', 'error'); return; }
  const texto0 = boton?.textContent ?? '';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const trozos: Blob[] = [];
    const g = new MediaRecorder(stream);
    _grabadora = g;
    g.ondataavailable = e => { if (e.data.size) trozos.push(e.data); };
    g.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      _grabadora = null;
      const blob = new Blob(trozos, { type: g.mimeType || 'audio/webm' });
      if (blob.size < 1000) { if (boton) { boton.textContent = texto0; boton.setAttribute('aria-pressed', 'false'); } toast('No se ha grabado nada', 'error'); return; }
      if (boton) boton.textContent = '… pasando a texto';
      const r = await llamarFuncion<{ texto: string }>('comandas', { accion: 'transcribir', audio: await aBase64(blob), mime: blob.type });
      if (boton) { boton.textContent = texto0; boton.setAttribute('aria-pressed', 'false'); }
      const texto = r.data?.texto?.trim();
      if (r.error || !texto) { toast(r.error ? `No se pudo pasar a texto: ${r.error}` : 'No se entendió nada', 'error'); return; }
      const campo = document.getElementById(campoId) as HTMLTextAreaElement | HTMLInputElement | null;
      if (campo) { campo.value = campo.value.trim() ? `${campo.value.trimEnd()}\n${texto}` : texto; campo.dispatchEvent(new Event('input', { bubbles: true })); }
    };
    g.start();
    if (boton) { boton.textContent = '⏹ Parar'; boton.setAttribute('aria-pressed', 'true'); }
  } catch { toast('No hay permiso para el micrófono: actívalo en el navegador', 'error'); }
}
