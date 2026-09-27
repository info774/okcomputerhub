// Dispatcher de eventos — TODOS los manejadores de la interfaz pasan por aquí.
// Portado de okcomputerclaude/public/js/dispatcher.js: no se escribe ningún
// `on*="…"` inline; un elemento declara QUÉ hace con atributos y esto decide
// CÓMO, con delegación en `document`.
//
//   data-action="fn" data-p0="a" data-p1="b"   → clic: fn('a', 'b')
//   data-on-input="fn:a,$value"                → input: fn('a', el.value)
//   data-on-keydown="fn" data-key="Enter" data-prevent="1"
//   data-stop="1"                              → stopPropagation()
//
// Tokens: $value, $checked, $this (el elemento), $event, $data:x, $field:id,
// $n:3, $b:true / $b:false, $null. Sin token, todo llega como texto.
// OJO: `$event` es el evento real; su currentTarget es `document`. El
// elemento se pide con `$this`.
//
// Diferencia con la app actual: las funciones no se buscan en `window` sino
// en el registro de `registrarAcciones({...})`, que cada módulo llama al
// cargarse. Con TypeScript y un bundler no hace falta el puente global.

type Accion = (...args: any[]) => unknown;
const ACCIONES = new Map<string, Accion>();

export function registrarAcciones(mapa: Record<string, Accion>) {
  for (const [k, fn] of Object.entries(mapa)) {
    if (ACCIONES.has(k) && ACCIONES.get(k) !== fn) console.warn(`[dispatcher] la acción "${k}" se redefine`);
    ACCIONES.set(k, fn);
  }
}

function token(v: string, el: HTMLElement, ev: Event): unknown {
  if (typeof v !== 'string' || v[0] !== '$') return v;
  const campo = el as HTMLInputElement;
  if (v === '$value') return campo.value;
  if (v === '$checked') return campo.checked;
  if (v === '$this') return el;
  if (v === '$event') return ev;
  if (v === '$null') return null;
  if (v === '$b:true') return true;
  if (v === '$b:false') return false;
  if (v.startsWith('$n:')) return Number(v.slice(3));
  if (v.startsWith('$data:')) return el.dataset[v.slice(6)];
  if (v.startsWith('$field:')) return (document.getElementById(v.slice(7)) as HTMLInputElement | null)?.value;
  return v;
}

function pargs(el: HTMLElement): string[] {
  const out: string[] = [];
  for (let i = 0; i <= 9; i++) {
    const v = el.dataset['p' + i];
    if (v === undefined) break;
    out.push(v);
  }
  return out;
}

function parse(spec: string, el: HTMLElement, ev: Event) {
  const i = spec.indexOf(':');
  if (i === -1) return { fn: spec.trim(), args: pargs(el).map(v => token(v, el, ev)) };
  const resto = spec.slice(i + 1);
  return { fn: spec.slice(0, i).trim(), args: resto === '' ? [] : resto.split(',').map(a => token(a, el, ev)) };
}

function resolver(nombre: string): Accion | null {
  return ACCIONES.get(nombre) ?? null;
}

function avisar(nombre: string) {
  // Sin handler el botón no hace NADA y sin rastro: que al menos quede dicho.
  console.warn(`[dispatcher] "${nombre}" no tiene acción registrada.`);
}

let instalado = false;
export function instalarDispatcher() {
  if (instalado) return;
  instalado = true;

  document.addEventListener('click', e => {
    const el = (e.target as Element | null)?.closest?.('[data-action]') as HTMLElement | null;
    if (!el) return;
    if (el.dataset.stop !== undefined) e.stopPropagation();
    if (el.dataset.prevent !== undefined) e.preventDefault();
    const nombre = el.dataset.action!;
    const fn = resolver(nombre);
    if (!fn) { avisar(nombre); return; }
    const r = fn(...pargs(el).map(v => token(v, el, e)));
    // Una acción async desde un <button> lo bloquea hasta que acaba: un doble
    // clic no crea dos registros.
    if (r instanceof Promise && el instanceof HTMLButtonElement && !el.disabled) {
      el.disabled = true;
      r.finally(() => { el.disabled = false; });
    }
  });

  const despachar = (nombre: string, e: Event, exacto = false) => {
    const attr = `data-on-${nombre}`;
    const t = e.target as Element | null;
    const el = (exacto
      ? (t instanceof Element && t.hasAttribute(attr) ? t : null)
      : t?.closest?.(`[${attr}]`)) as HTMLElement | null;
    if (!el) return;
    const k = el.dataset.key;
    if (k && (nombre === 'keydown' || nombre === 'keyup') && !k.split('|').includes((e as KeyboardEvent).key)) return;
    if (el.dataset.stop !== undefined) e.stopPropagation();
    if (el.dataset.prevent !== undefined) e.preventDefault();
    const { fn, args } = parse(el.getAttribute(attr)!, el, e);
    const f = resolver(fn);
    if (!f) { avisar(fn); return; }
    f(...args);
  };

  // Arrastrar y soltar también burbujea: se delega igual. `pointermove` /
  // `pointerout` (burbujean; `pointerleave` no) son para el hover de las gráficas. `dragover` necesita
  // data-prevent="1" en la zona de soltar (si no, el navegador no deja soltar).
  for (const ev of ['input', 'change', 'keyup', 'keydown', 'submit', 'dblclick', 'contextmenu', 'paste',
                    'dragstart', 'dragend', 'dragover', 'dragleave', 'drop', 'pointermove', 'pointerout']) {
    document.addEventListener(ev, e => despachar(ev, e));
  }
  for (const ev of ['focus', 'blur']) {
    document.addEventListener(ev, e => despachar(ev, e, true), true);
  }
}
