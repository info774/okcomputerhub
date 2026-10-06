// Hoy · modo calle (fase Final): pensado para el móvil del técnico. Paradas del
// día (bloques de agenda y trabajos programados que son suyos), la SIGUIENTE
// arriba con Llamar · Cómo llegar · Ficha, y el fichaje en curso. Con las
// áreas cortadas: fichar (hub.fichar, las reglas de la app) y «Terminar»
// (qué se hizo + FOTO OBLIGATORIA, como en la app → fin → Completado).
// Prefijo de ids: ho-.
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { telWhatsApp } from '../ventas/datos';
import { esMio } from '../trabajos/vista';

interface Parada { clave: string; trabajo: any | null; inicio: string | null; fin: string | null; titulo: string; local: any | null; cliente: any | null; tel: string | null }
const hora = (v: string | null) => v ? new Date(v).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
const minutos = (desde: string) => Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60000));
let _sesion: any = null;
let _terminar: string | null = null;

async function gps(): Promise<{ p_lat: number | null; p_lng: number | null }> {
  if (!navigator.geolocation) return { p_lat: null, p_lng: null };
  // Si el navegador se queda preguntando el permiso, no hay respuesta nunca: a los 6 s se ficha sin GPS.
  return new Promise(ok => {
    const t = setTimeout(() => ok({ p_lat: null, p_lng: null }), 6000);
    navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); ok({ p_lat: p.coords.latitude, p_lng: p.coords.longitude }); },
      () => { clearTimeout(t); ok({ p_lat: null, p_lng: null }); }, { timeout: 5000, maximumAge: 60000 });
  });
}

export async function pintar(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const yo = usuario();
  const d = new Date().toLocaleDateString('sv-SE');
  const ini = new Date(`${d}T00:00:00`).toISOString(), fin = new Date(`${d}T23:59:59`).toISOString();
  const [ses, ag, tr, escribe] = await Promise.all([
    API.get<any[]>('sesiones', { select: '*', tecnico_id: `eq.${yo?.id}`, fin: 'is.null', order: 'created_at.desc', limit: '1' }),
    API.get<any[]>('agenda', { select: 'id,trabajo_id,titulo,inicio,fin,tecnicos', and: `(inicio.lte.${fin},fin.gte.${ini})`, order: 'inicio' }),
    API.get<any[]>('trabajos', { select: 'id,numero,titulo,descripcion,estado,tecnicos,cliente_id,local_id,contacto_id,fecha_programada,hora_llegada', fecha_programada: `eq.${d}` }),
    esDelHub('sesiones', 'trabajos')]);
  _sesion = (ses.data ?? [])[0] ?? null;
  const bloques = (ag.data ?? []).filter(b => esMio(b.tecnicos));
  const ids = [...new Set([...bloques.map(b => b.trabajo_id), ...(tr.data ?? []).filter(t => esMio(t.tecnicos)).map(t => t.id), _sesion?.entidad_tipo === 'trabajo' ? _sesion.entidad_id : null].filter(Boolean))];
  const trabajos = ids.length ? (await API.get<any[]>('trabajos', { select: 'id,numero,titulo,descripcion,estado,tecnicos,cliente_id,local_id,contacto_id,fecha_programada,hora_llegada', id: `in.(${ids.join(',')})` })).data ?? [] : [];
  const lids = [...new Set(trabajos.map(t => t.local_id).filter(Boolean))], cids = [...new Set(trabajos.map(t => t.cliente_id).filter(Boolean))], kids = [...new Set(trabajos.map(t => t.contacto_id).filter(Boolean))];
  const [ls, cs, ks] = await Promise.all([
    lids.length ? API.get<any[]>('locales', { select: 'id,nombre,direccion,lat,lng', id: `in.(${lids.join(',')})` }) : Promise.resolve({ data: [] as any[] }),
    cids.length ? API.get<any[]>('clientes', { select: 'id,nombre,telefono', id: `in.(${cids.join(',')})` }) : Promise.resolve({ data: [] as any[] }),
    kids.length ? API.get<any[]>('contactos', { select: 'id,nombre,telefono', id: `in.(${kids.join(',')})` }) : Promise.resolve({ data: [] as any[] })]);
  const hacer = (t: any, inicio: string | null, finB: string | null, clave: string): Parada => {
    const c = (cs.data ?? []).find(x => x.id === t?.cliente_id), k = (ks.data ?? []).find(x => x.id === t?.contacto_id);
    return { clave, trabajo: t, inicio, fin: finB, titulo: t ? `#${t.numero} ${t.titulo ?? (t.descripcion ?? '').slice(0, 60)}` : 'Cita', local: (ls.data ?? []).find(x => x.id === t?.local_id) ?? null, cliente: c ?? null, tel: k?.telefono ?? c?.telefono ?? null };
  };
  const paradas: Parada[] = [
    ...bloques.map(b => hacer(trabajos.find(t => t.id === b.trabajo_id) ?? null, b.inicio, b.fin, b.id)),
    ...trabajos.filter(t => t.fecha_programada === d && esMio(t.tecnicos) && !bloques.some(b => b.trabajo_id === t.id)).map(t => hacer(t, t.hora_llegada ? new Date(`${d}T${t.hora_llegada}`).toISOString() : null, null, t.id)),
  ].sort((a, b) => (a.inicio ?? '9').localeCompare(b.inicio ?? '9'));
  const pendientes = paradas.filter(p => !['Completado', 'Para facturar', 'Facturado', 'Cancelado', 'No facturar'].includes(p.trabajo?.estado ?? ''));
  const siguiente = pendientes.find(p => !p.fin || new Date(p.fin) > new Date()) ?? pendientes[0];
  const enCurso = _sesion ? trabajos.find(t => _sesion.entidad_tipo === 'trabajo' && t.id === _sesion.entidad_id) : null;
  const mapa = (l: any) => l?.lat && l?.lng ? `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}` : l?.direccion ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.direccion)}` : null;
  const tarjeta = (p: Parada, grande = false) => {
    const wa = telWhatsApp(p.tel), m = mapa(p.local), t = p.trabajo;
    const activo = enCurso && t && enCurso.id === t.id;
    return `<article class="tarjeta ho-parada ${grande ? 'ho-siguiente' : ''}"><header><strong>${esc(hora(p.inicio) || '—')}</strong> ${t ? `<a href="#/trabajos/${t.numero}">${esc(p.titulo)}</a>` : esc(p.titulo)}
        ${t ? `<span class="chip">${esc(t.estado)}</span>` : ''}</header>
      ${p.cliente || p.local ? `<p class="nota">${[p.cliente?.nombre, p.local?.nombre, p.local?.direccion].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
      ${grande && t?.descripcion ? `<p>${esc(t.descripcion.slice(0, 280))}</p>` : ''}
      ${p.tel || m || (escribe && t) ? `<div class="acciones ho-botones">${p.tel ? `<a class="btn secundario" href="tel:${esc(p.tel)}">${ico('telefono')} Llamar</a>` : ''}${wa && grande ? `<a class="btn secundario" href="https://wa.me/${wa}" target="_blank" rel="noopener" aria-label="WhatsApp">${ico('mensaje')}</a>` : ''}
        ${m ? `<a class="btn secundario" href="${esc(m)}" target="_blank" rel="noopener">${ico('mapa')} Cómo llegar</a>` : ''}
        ${escribe && t && !activo ? `<button class="btn" data-action="hoInicio" data-p0="${t.id}">${ico('play')} Empezar</button>` : ''}
        ${escribe && t && (activo || grande) ? `<button class="btn secundario" data-action="hoTerminar" data-p0="${t.id}">${ico('hecho')} Terminar</button>` : ''}</div>` : ''}
      ${_terminar === t?.id ? `<form class="ho-terminar" data-on-submit="hoGuardarTerminar:${t.id}" data-prevent="1"><label>Qué se hizo <textarea id="ho-hecho" rows="3" required></textarea></label>
        <label>Foto (obligatoria) <input type="file" id="ho-foto" accept="image/*" capture="environment" required></label>
        <div class="acciones"><button class="btn" type="submit">Terminar trabajo</button></div></form>` : ''}</article>`;
  };
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('El fichaje')}
    <section class="tarjeta ho-fichaje">${_sesion ? `<p>${ico('cronometro')} ${_sesion.inicio ? `Trabajando en <strong>${esc(enCurso ? `#${enCurso.numero} ${enCurso.titulo ?? ''}` : _sesion.entidad_tipo ?? '')}</strong> desde las ${hora(_sesion.inicio)} (${minutos(_sesion.inicio)} min)`
        : `${ico('coche')} En traslado desde las ${hora(_sesion.traslado)}`}</p>${escribe && _sesion.inicio ? `<button class="btn" data-action="hoFin">${ico('parar')} Fichar fin</button>` : ''}`
      : `<p>No tienes nada fichado ahora.</p>${escribe ? `<button class="btn secundario" data-action="hoTraslado">${ico('coche')} Salgo para allá (traslado)</button>` : ''}`}</section>
    ${siguiente ? `<h3>Siguiente</h3>${tarjeta(siguiente, true)}` : `<p class="vacio">No tienes más paradas hoy. ${ico('trofeo')}</p>`}
    ${paradas.length > 1 ? `<h3>Todo el día (${paradas.length})</h3>${paradas.filter(p => p !== siguiente).map(p => tarjeta(p)).join('')}` : ''}`;
}

const aBase64 = (f: Blob) => new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = mal; r.readAsDataURL(f); });

registrarAcciones({
  async hoTraslado() {
    const r = await API.rpc('fichar', { p_accion: 'traslado', ...(await gps()) });
    if (r.error) toast(r.error.message, 'error'); else { toast('Traslado iniciado'); resolver(); }
  },
  async hoInicio(id: string) {
    const r = await API.rpc('fichar', { p_accion: 'inicio', p_tipo: 'trabajo', p_id: id, ...(await gps()) });
    if (r.error) toast(r.error.message, 'error'); else { toast('Inicio fichado'); resolver(); }
  },
  async hoFin() {
    if (!confirm('¿Fichar el fin? Las horas ya no se recuperan sin corregirlas a mano.')) return;
    const r = await API.rpc('fichar', { p_accion: 'fin' });
    if (r.error) toast(r.error.message, 'error'); else { toast('■ Fin fichado'); resolver(); }
  },
  hoTerminar(id: string) { _terminar = _terminar === id ? null : id; resolver(); },
  async hoGuardarTerminar(id: string) {
    const foto = (document.getElementById('ho-foto') as HTMLInputElement).files?.[0];
    const hecho = (document.getElementById('ho-hecho') as HTMLTextAreaElement).value.trim();
    if (!foto) { toast('La foto es obligatoria', 'error'); return; }
    if (_sesion?.inicio && _sesion.entidad_id === id) {
      const f = await API.rpc('fichar', { p_accion: 'fin' });
      if (f.error) { toast(f.error.message, 'error'); return; }
    }
    const up = await llamarFuncion('trabajo-foto', { accion: 'subir', trabajo_id: id, archivo: await aBase64(foto), tipo: foto.type || 'image/jpeg', descripcion: 'Al terminar' }, 90000);
    if (up.error) { toast(`No se pudo subir la foto: ${up.error}`, 'error'); return; }
    const { data: t } = await API.single<any>('trabajos', { select: 'observaciones', id: `eq.${id}` });
    await API.patch('trabajos', { id: `eq.${id}` }, { observaciones: [t?.observaciones, hecho].filter(Boolean).join('\n\n') });
    const r = await API.rpc('trabajo_estado', { p_id: id, p_estado: 'Completado' });
    if (r.error) toast(r.error.message, 'error'); else { toast('✓ Trabajo terminado'); _terminar = null; resolver(); }
  },
});
