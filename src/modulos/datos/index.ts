// Datos y sincronización: de dónde salen los datos del hub y cómo de frescos
// están. Enseña hub.sync_estado (incremental y nocturna), las áreas con su
// dueño (app | hub) y cuántas filas tiene cada tabla espejo. Un admin puede
// lanzar la sincronización a mano.
import type { Modulo, Contador } from '../../core/modulo';
import { API, type Fila } from '../../core/api';
import { FUNCIONES_URL, SUPABASE_ANON_KEY } from '../../core/config';
import { token } from '../../core/auth';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { esc, fechaHora, hace, toast } from '../../ui/dom';
import { ir } from '../../core/router';

const RETRASO_MAX_MIN = 60; // más de esto sin una pasada buena = algo va mal

async function contador(): Promise<Contador | null> {
  const { data, error } = await API.get('sync_estado', { clave: 'eq.audit', select: 'ultima_ok,ultimo_error,ultimo_error_at' });
  if (error || !data?.[0]) return null;
  const e = data[0];
  const fallaAhora = e.ultimo_error && (!e.ultima_ok || e.ultimo_error_at > e.ultima_ok);
  const min = e.ultima_ok ? (Date.now() - new Date(e.ultima_ok).getTime()) / 60000 : Infinity;
  return {
    valor: e.ultima_ok ? hace(e.ultima_ok) : 'sin datos',
    subtitulo: fallaAhora ? 'la última pasada falló' : 'última sincronización',
    tono: fallaAhora || min > RETRASO_MAX_MIN ? 'mal' : 'bien',
  };
}

function filaEstado(e: Fila, nombre: string): string {
  const fallaAhora = e.ultimo_error && (!e.ultima_ok || e.ultimo_error_at > e.ultima_ok);
  const detalle = e.detalle ? Object.entries(e.detalle).map(([t, n]) => `${esc(t)}: ${esc(n)}`).join(' · ') : '';
  return `<tr>
    <td>${esc(nombre)}</td>
    <td>${e.ultima_ok ? `${esc(hace(e.ultima_ok))}<br><small>${esc(fechaHora(e.ultima_ok))}</small>` : 'nunca'}</td>
    <td>${esc(e.filas ?? '—')}${detalle ? `<br><small>${detalle}</small>` : ''}</td>
    <td>${fallaAhora ? `<span class="chip mal">${esc(String(e.ultimo_error).slice(0, 200))}</span>` : '<span class="chip bien">bien</span>'}</td>
  </tr>`;
}

async function pintar(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [estado, areas] = await Promise.all([
    API.get('sync_estado', { select: '*', order: 'clave' }),
    API.get('areas', { select: '*', order: 'area' }),
  ]);
  if (estado.error || areas.error) {
    el.innerHTML = `<p class="aviso mal">No se pudo leer el estado: ${esc((estado.error ?? areas.error)!.message)}</p>`;
    return;
  }
  const tablas = (areas.data ?? []).flatMap(a => a.tablas as string[]);
  const cuentas = await Promise.all(tablas.map(t => API.contar(t)));
  const n = new Map(tablas.map((t, i) => [t, cuentas[i]]));
  const e = new Map((estado.data ?? []).map(x => [x.clave, x]));

  el.innerHTML = `
    <section class="tarjeta">
      <div class="tarjeta-cab">
        <h2>Sincronización con la app actual</h2>
        ${esAdmin() ? `<div class="acciones">
          <button class="btn" data-action="datosSincronizar" data-p0="incremental">Sincronizar ahora</button>
          <button class="btn secundario" data-action="datosSincronizar" data-p0="completo">Pasada completa</button>
        </div>` : ''}
      </div>
      <table class="tabla">
        <thead><tr><th>Pasada</th><th>Última buena</th><th>Filas</th><th>Estado</th></tr></thead>
        <tbody>
          ${filaEstado(e.get('audit') ?? {}, 'Incremental (cada 15 min)')}
          ${filaEstado(e.get('completo') ?? {}, 'Completa (cada noche)')}
        </tbody>
      </table>
    </section>
    <section class="tarjeta">
      <h2>Áreas</h2>
      <p class="nota">Con dueño <b>app</b>, el hub enseña el área en solo lectura y el sync la refresca. Al cortarla pasa a <b>hub</b>: el hub escribe y el sync la deja en paz.</p>
      <table class="tabla">
        <thead><tr><th>Área</th><th>Dueño</th><th>Tablas (filas en el hub)</th><th>Notas</th></tr></thead>
        <tbody>${(areas.data ?? []).map(a => `<tr>
          <td>${esc(a.area)}</td>
          <td><span class="chip ${a.dueno === 'hub' ? 'bien' : 'neutro'}">${esc(a.dueno)}</span></td>
          <td>${(a.tablas as string[]).map(t => `${esc(t)} <small>(${esc(n.get(t) ?? '?')})</small>`).join(', ')}</td>
          <td>${esc(a.notas ?? '')}</td>
        </tr>`).join('')}</tbody>
      </table>
    </section>`;
}

async function sincronizar(modo: string) {
  try {
    const res = await fetch(`${FUNCIONES_URL}/sync-app`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ modo }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok || !r.ok) toast(`Falló: ${r.error ?? res.status}`, 'error');
    else toast(`Hecho: ${r.filas ?? 0} filas`);
  } catch (e: any) {
    toast(`Falló: ${e?.message ?? e}`, 'error');
  }
  ir('datos');
}

registrarAcciones({ datosSincronizar: sincronizar });

export const moduloDatos: Modulo = {
  id: 'datos',
  titulo: 'Datos y sincronización',
  grupo: 'Sistema',
  icono: '🔄',
  explicacion: 'De dónde salen los datos del hub. Mientras un área siga en la app actual, aquí se ve una copia que se refresca cada 15 minutos (y entera cada noche). Si la última pasada falló o lleva más de una hora sin pasar, sale en rojo.',
  pintar,
  contador,
};
