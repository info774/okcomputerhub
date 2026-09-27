// Router por hash: #/<modulo>/<param>/<param>…
import type { Modulo } from './modulo';

const MODULOS = new Map<string, Modulo>();
let _alNavegar: (m: Modulo, params: string[]) => void = () => {};

export function registrarModulos(lista: Modulo[]) {
  for (const m of lista) {
    if (MODULOS.has(m.id)) throw new Error(`Módulo repetido: ${m.id}`);
    MODULOS.set(m.id, m);
  }
}

export const modulos = () => [...MODULOS.values()];
export const modulo = (id: string) => MODULOS.get(id);

export function rutaActual(): { id: string; params: string[] } {
  const [id = 'inicio', ...params] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { id, params };
}

export function ir(id: string, ...params: string[]) {
  const h = '#/' + [id, ...params].map(encodeURIComponent).join('/');
  if (location.hash === h) resolver(); else location.hash = h;
}

export function resolver() {
  const { id, params } = rutaActual();
  const m = MODULOS.get(id) ?? MODULOS.get('inicio');
  if (m) _alNavegar(m, params);
}

export function iniciarRouter(alNavegar: (m: Modulo, params: string[]) => void) {
  _alNavegar = alNavegar;
  window.addEventListener('hashchange', resolver);
  resolver();
}
