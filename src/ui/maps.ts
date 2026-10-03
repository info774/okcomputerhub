// Buscar un negocio en Google Maps y traer su ficha (integrations/google-places.js
// de la app): nombre, dirección, teléfono, horario y enlace. Lo usan el alta y la
// edición de sede y la sede rápida del alta de trabajo.
// TODA búsqueda se limita a Tenerife en dos capas, como la app:
//   1. locationRestriction con la caja de la isla (SOLA: con locationBias a la
//      vez Google contesta INVALID_REQUEST y la búsqueda sale siempre vacía).
//   2. Al abrir la ficha se comprueban las coordenadas (`fueraDeTenerife`).
// El SDK se carga bajo demanda, una sola vez, en español y región ES.
//
// Pieza de interfaz: buscadorMaps(prefijo) pinta la caja y la lista, y
// alElegirLugar(prefijo, fn) dice qué hacer con el lugar elegido.
import { PLACES_API_KEY } from '../core/config';
import { registrarAcciones } from '../core/dispatcher';
import { esc, toast } from './dom';

export interface Lugar { nombre: string; direccion: string; telefono: string; horario: string; mapsUrl: string; lat?: number; lng?: number; fueraDeTenerife: boolean }
interface Prediccion { placeId: string; nombre: string; direccion: string }

export const TENERIFE = { sur: 27.95, norte: 28.65, oeste: -17.0, este: -16.05 };
const CENTRO = { lat: 28.29, lng: -16.58 };

export const enTenerife = (lat?: number, lng?: number) =>
  typeof lat === 'number' && typeof lng === 'number' && lat >= TENERIFE.sur && lat <= TENERIFE.norte && lng >= TENERIFE.oeste && lng <= TENERIFE.este;

const g = () => (window as any).google;
let _cargando: Promise<void> | null = null;
let _servicio: any = null;

export function cargarMaps(): Promise<void> {
  if (g()?.maps?.places) return Promise.resolve();
  if (_cargando) return _cargando;
  _cargando = new Promise<void>((ok, mal) => {
    const s = document.createElement('script');
    s.id = 'gmaps-script';
    s.src = `https://maps.googleapis.com/maps/api/js?key=${PLACES_API_KEY}&libraries=places&language=es&region=ES`;
    s.onload = () => ok();
    s.onerror = () => { _cargando = null; mal(new Error('No se pudo cargar Google Maps')); };
    document.head.appendChild(s);
  });
  return _cargando;
}

const caja = () => new (g().maps.LatLngBounds)({ lat: TENERIFE.sur, lng: TENERIFE.oeste }, { lat: TENERIFE.norte, lng: TENERIFE.este });

/** Sugerencias dentro de Tenerife. Solo ZERO_RESULTS es lista vacía: otro fallo (clave, cuota) lanza error. */
export async function buscarLugares(texto: string, limite = 6): Promise<Prediccion[]> {
  const q = texto.trim();
  if (!q) return [];
  await cargarMaps();
  const auto = new (g().maps.places.AutocompleteService)();
  return new Promise((ok, mal) => {
    auto.getPlacePredictions({ input: q, language: 'es', types: ['establishment'], componentRestrictions: { country: 'es' }, locationRestriction: caja() },
      (pred: any[] | null, estado: string) => {
        const S = g().maps.places.PlacesServiceStatus;
        if (estado === S.ZERO_RESULTS) return ok([]);
        if (estado !== S.OK) return mal(new Error(`places-${estado}`));
        ok((pred ?? []).slice(0, limite).map(p => ({
          placeId: p.place_id, nombre: p.structured_formatting?.main_text || p.description, direccion: p.structured_formatting?.secondary_text || '',
        })));
      });
  });
}

/** Ficha de un lugar (null si Google no la da). */
export async function detalleLugar(placeId: string): Promise<Lugar | null> {
  await cargarMaps();
  if (!_servicio) {
    const div = document.createElement('div');
    div.style.cssText = 'display:none;width:1px;height:1px';
    document.body.appendChild(div);
    _servicio = new (g().maps.places.PlacesService)(new (g().maps.Map)(div, { center: CENTRO, zoom: 10 }));
  }
  return new Promise(ok => {
    _servicio.getDetails({ placeId, fields: ['name', 'formatted_address', 'formatted_phone_number', 'opening_hours', 'geometry', 'url'], language: 'es' },
      (l: any, estado: string) => {
        if (estado !== g().maps.places.PlacesServiceStatus.OK || !l) return ok(null);
        const lat = l.geometry?.location?.lat?.(), lng = l.geometry?.location?.lng?.();
        ok({ nombre: l.name ?? '', direccion: l.formatted_address ?? '', telefono: l.formatted_phone_number ?? '',
          horario: l.opening_hours?.weekday_text?.join('\n') ?? '', mapsUrl: l.url ?? '', lat, lng, fueraDeTenerife: !enTenerife(lat, lng) });
      });
  });
}

// ── La pieza de interfaz ────────────────────────────────────────────────────
const _destinos = new Map<string, (l: Lugar) => void>();
export const alElegirLugar = (prefijo: string, fn: (l: Lugar) => void) => { _destinos.set(prefijo, fn); };

export const buscadorMaps = (prefijo: string) => `<div class="maps-buscar">
    <input id="${prefijo}-maps-q" type="search" autocomplete="off" placeholder="Nombre del negocio…" aria-label="Buscar en Google Maps"
      data-on-keydown="mapsBuscar:${prefijo}" data-key="Enter" data-prevent="1">
    <button type="button" class="btn secundario" data-action="mapsBuscar" data-p0="${prefijo}">🔎 Buscar en Google Maps</button></div>
  <ul id="${prefijo}-maps-res" class="resultados" aria-live="polite"></ul>`;

registrarAcciones({
  async mapsBuscar(prefijo: string) {
    const q = (document.getElementById(`${prefijo}-maps-q`) as HTMLInputElement | null)?.value.trim() ?? '';
    const ul = document.getElementById(`${prefijo}-maps-res`);
    if (!ul || !q) return;
    ul.innerHTML = '<li class="nota">Buscando…</li>';
    let lugares: Prediccion[];
    // Un fallo de Google (clave, cuota, red) se dice: no es «ese negocio no existe».
    try { lugares = await buscarLugares(q); }
    catch { ul.innerHTML = '<li class="nota">No se ha podido consultar Google Maps. Inténtalo de nuevo en un momento.</li>'; return; }
    ul.innerHTML = lugares.length
      ? lugares.map(l => `<li><button type="button" data-action="mapsElegir" data-p0="${esc(prefijo)}" data-p1="${esc(l.placeId)}"><strong>${esc(l.nombre)}</strong> <small class="nota">📍 ${esc(l.direccion)}</small></button></li>`).join('')
      : `<li class="nota">Sin resultados en Tenerife. Prueba con otro nombre o <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}" target="_blank" rel="noopener">búscalo en Google Maps ↗</a>.</li>`;
  },
  async mapsElegir(prefijo: string, placeId: string) {
    const l = await detalleLugar(placeId);
    if (!l) { toast('Google Maps no ha dado la ficha de ese sitio', 'error'); return; }
    if (l.fueraDeTenerife) toast('Ese sitio no está en Tenerife: revisa la dirección antes de guardar', 'error');
    _destinos.get(prefijo)?.(l);
    const ul = document.getElementById(`${prefijo}-maps-res`); if (ul) ul.innerHTML = '';
    const q = document.getElementById(`${prefijo}-maps-q`) as HTMLInputElement | null; if (q) q.value = '';
    if (!l.fueraDeTenerife) toast('Datos traídos de Google Maps');
  },
});
