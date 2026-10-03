// Motor del planificador: las reglas del calendario de la app
// (okcomputerclaude/public/js/modules/calendario.js) en funciones puras, sin
// DOM: solapes, traslados entre sedes, carga del día y «Sugerir hueco». Si
// cambian allí (constantes, criterio de solape o de hueco), cambiarlas aquí.

export interface Ev {
  id: string; key: string; trabajoId: string | null; tareaId: string | null; ticketId: string | null;
  numero: number | null; titulo: string; cliente: string | null; sede: string | null; localId: string | null;
  inicio: Date; fin: Date; tecnicos: string[]; estado: string | null; todoDia: boolean;
}
export interface Coords { lat: number; lng: number }
export interface Traslado { min: number; km: number | null; estimado: boolean }

// Mismas constantes que la app: línea recta × 1,3 a 40 km/h más 5 min; una sede
// sin coordenadas cuenta 30 min y se dice. Jornada de 8 h por técnico.
export const VEL_KMH = 40, FACTOR_RUTA = 1.3, TRASLADO_FIJO_MIN = 5, TRASLADO_DESCONOCIDO_MIN = 30;
export const JORNADA_MIN = 8 * 60;
export const HORA_INICIO = 9, HORA_FIN = 19;   // franja de «Sugerir hueco» (CAL_HOUR_START/END)
// Salida de la oficina: la tienda de Armeñime (C/ Agustín Millares 6B, Adeje).
// Aproximada; la app la geocodifica de la dirección de la empresa.
export const OFICINA: Coords = { lat: 28.0935, lng: -16.7565 };

export const dia = (d: Date) => d.toLocaleDateString('sv-SE');
export const horaDe = (d: Date) => d.getHours() + d.getMinutes() / 60;
export const durMin = (e: Ev) => Math.max(15, Math.round((e.fin.getTime() - e.inicio.getTime()) / 60000));
const finH = (e: Ev) => horaDe(e.inicio) + durMin(e) / 60;
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Los técnicos van por NOMBRE, completo o de pila («Matteo» / «Matteo Monastero»).
export const mismaPersona = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x === y.split(/\s+/)[0] || y === x.split(/\s+/)[0]); };
export const deTecnico = (e: Ev, tec: string) => e.tecnicos.some(t => mismaPersona(t, tec));

export function kmEntre(a: Coords, b: Coords): number {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Minutos de una sede a otra (o desde la oficina, `de` = null).
export function traslado(de: string | null, a: string | null, coords: Map<string, Coords | null>, desdeOficina = false): Traslado | null {
  if (!desdeOficina && !de) return null;
  if (!desdeOficina && de === a) return { min: 0, km: 0, estimado: false };
  const p = desdeOficina ? OFICINA : coords.get(de!) ?? null;
  const q = a ? coords.get(a) ?? null : null;
  if (p && q) {
    const km = kmEntre(p, q) * FACTOR_RUTA;
    return { min: Math.max(TRASLADO_FIJO_MIN, Math.round(km / VEL_KMH * 60 + TRASLADO_FIJO_MIN)), km, estimado: false };
  }
  return { min: TRASLADO_DESCONOCIDO_MIN, km: null, estimado: true };
}

// Bloques del día de un técnico, ordenados (sin los de todo el día).
const delDia = (evs: Ev[], ds: string, tec: string) =>
  evs.filter(e => !e.todoDia && dia(e.inicio) === ds && deTecnico(e, tec)).sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

// Solapes: dos bloques del MISMO técnico a la misma hora (el mismo trabajo
// partido no cuenta). Devuelve las claves que solapan y la lista para el aviso.
export function solapes(evs: Ev[], equipo: string[]): { claves: Set<string>; lista: { tecnico: string; a: Ev; b: Ev }[] } {
  const claves = new Set<string>(), lista: { tecnico: string; a: Ev; b: Ev }[] = [];
  const dias = [...new Set(evs.map(e => dia(e.inicio)))];
  const personas = [...new Set([...equipo, ...evs.flatMap(e => e.tecnicos)])].filter((p, i, xs) => xs.findIndex(q => mismaPersona(p, q)) === i);
  for (const ds of dias) for (const tec of personas) {
    const l = delDia(evs, ds, tec);
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      const a = l[i], b = l[j];
      if (horaDe(b.inicio) >= finH(a)) break;
      if (a.trabajoId && a.trabajoId === b.trabajoId) continue;
      claves.add(a.key); claves.add(b.key);
      lista.push({ tecnico: tec, a, b });
    }
  }
  return { claves, lista };
}

// Traslados de un día: por técnico, de cada bloque al siguiente (el primero,
// desde la oficina). `tarde` = minutos que faltan cuando el hueco no da.
export interface TrasladoDia { ev: Ev; tecnico: string; min: number; km: number | null; estimado: boolean; tarde: number; desde: string }
export function trasladosDelDia(evs: Ev[], ds: string, equipo: string[], coords: Map<string, Coords | null>): TrasladoDia[] {
  const out: TrasladoDia[] = [];
  for (const tec of equipo) {
    const l = delDia(evs, ds, tec);
    l.forEach((e, i) => {
      const prev = l[i - 1] ?? null;
      if (prev && horaDe(e.inicio) < finH(prev)) return;   // solapados: ya lo avisa el solape
      const t = prev ? traslado(prev.localId, e.localId, coords) : traslado(null, e.localId, coords, true);
      if (!t || t.min < TRASLADO_FIJO_MIN) return;
      const hueco = prev ? (horaDe(e.inicio) - finH(prev)) * 60 : Infinity;
      out.push({ ev: e, tecnico: tec, min: t.min, km: t.km, estimado: t.estimado, tarde: Math.max(0, Math.round(t.min - hueco)),
        desde: prev ? (prev.sede || prev.cliente || prev.titulo) : 'la oficina' });
    });
  }
  return out;
}

// Carga del día: minutos planificados frente a técnicos × 8 h, y quién está libre.
export function cargaDia(evs: Ev[], ds: string, equipo: string[]) {
  const porTec = new Map<string, number>();
  let total = 0;
  for (const e of evs) {
    if (e.todoDia || dia(e.inicio) !== ds) continue;
    const m = durMin(e);
    total += m;
    for (const t of e.tecnicos.length ? e.tecnicos : ['']) porTec.set(t, (porTec.get(t) ?? 0) + m);
  }
  const capacidad = Math.max(1, equipo.length) * JORNADA_MIN;
  const libres = equipo.filter(n => ![...porTec.entries()].some(([t, m]) => m > 0 && mismaPersona(t, n)));
  return { total, capacidad, libres, porTec };
}
export const durCorta = (m: number) => (!m ? '0h' : m % 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m / 60}h`);

// «Sugerir hueco»: la primera franja libre de los próximos 14 días (sin
// domingos), de 9 a 19 en pasos de 15 min, técnico a técnico (el asignado o
// todos), donde nadie tenga nada encima y dé tiempo a llegar desde la parada
// anterior (u oficina) y a salir hacia la siguiente. `saltar` = «Otro hueco».
export interface Pendiente { id: string; numero: number; titulo: string; duracion: number | null; tecnico: string; localId: string | null }
export interface Hueco { trabajoId: string; numero: number; titulo: string; fecha: string; hora: number; dur: number; tecnico: string; viene: { desde: string; min: number; estimado: boolean } | null; n: number }
export function buscarHueco(t: Pendiente, evs: Ev[], equipo: string[], coords: Map<string, Coords | null>, opciones: { saltar?: number; traslados?: boolean; ahora?: Date } = {}): Hueco | null {
  const dur = Math.max(15, Number(t.duracion) || 60);
  const candidatos = t.tecnico ? [t.tecnico] : equipo.length ? equipo : [''];
  const ahora = opciones.ahora ?? new Date();
  const hoyStr = dia(ahora), hAhora = horaDe(ahora);
  const conTraslados = opciones.traslados !== false;
  let n = 0;
  for (let d = 0; d < 14; d++) {
    const dd = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + d, 12);
    if (dd.getDay() === 0) continue;
    const ds = dia(dd);
    const delDiaTodos = evs.filter(e => !e.todoDia && dia(e.inicio) === ds && e.trabajoId !== t.id);
    for (let h = HORA_INICIO; h + dur / 60 <= HORA_FIN + 1e-9; h += 0.25) {
      if (ds === hoyStr && h < hAhora) continue;
      for (const tec of candidatos) {
        const mios = tec ? delDiaTodos.filter(e => deTecnico(e, tec)) : delDiaTodos;
        if (mios.some(e => horaDe(e.inicio) < h + dur / 60 && finH(e) > h)) continue;
        let viene: Hueco['viene'] = null;
        if (conTraslados && tec) {
          const orden = [...mios].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
          const prev = [...orden].reverse().find(e => finH(e) <= h + 1e-9) ?? null;
          const next = orden.find(e => horaDe(e.inicio) >= h + dur / 60 - 1e-9) ?? null;
          const t1 = prev ? traslado(prev.localId, t.localId, coords) : traslado(null, t.localId, coords, true);
          if (t1 && prev && finH(prev) + t1.min / 60 > h + 1e-9) continue;
          const t2 = next ? traslado(t.localId, next.localId, coords) : null;
          if (t2 && next && h + dur / 60 + t2.min / 60 > horaDe(next.inicio) + 1e-9) continue;
          if (t1 && t1.min >= TRASLADO_FIJO_MIN) viene = { desde: prev ? (prev.sede || prev.cliente || prev.titulo) : 'la oficina', min: t1.min, estimado: t1.estimado };
        }
        if (n++ < (opciones.saltar ?? 0)) continue;
        return { trabajoId: t.id, numero: t.numero, titulo: t.titulo, fecha: ds, hora: h, dur, tecnico: tec, viene, n: n - 1 };
      }
    }
  }
  return null;
}
export const horaTexto = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
