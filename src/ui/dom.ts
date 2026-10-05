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

// Fecha de calendario para enseñar («5 oct», o «5 oct 2025» si no es de este
// año; `conAnio` lo pone siempre). Acepta 'AAAA-MM-DD' (sin pasar por UTC) o
// un instante ISO. Lo que no se entienda sale tal cual.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
export function fecha(v: string | null | undefined, conAnio = false): string {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const anio = conAnio || d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MESES[d.getMonth()]}${anio}`;
}

// «1 alerta» / «3 alertas»: la cifra con su palabra en singular o plural.
export const pl = (n: number | null | undefined, uno: string, varios: string): string => `${n ?? 0} ${n === 1 ? uno : varios}`;

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
