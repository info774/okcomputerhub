// Utilidades de DOM comunes.

// Escapar SIEMPRE lo que venga de datos antes de meterlo en innerHTML.
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, raiz: ParentNode = document) =>
  raiz.querySelector(sel) as T | null;

export function fechaHora(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

export function hace(v: string | null | undefined): string {
  if (!v) return 'nunca';
  const min = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

let _timerToast: number | undefined;
export function toast(msg: string, tipo: 'info' | 'error' = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast visible ${tipo}`;
  clearTimeout(_timerToast);
  _timerToast = window.setTimeout(() => el!.classList.remove('visible'), 3500);
}
