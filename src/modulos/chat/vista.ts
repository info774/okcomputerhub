// Chat del hub (fase Final): #/chat y #/chat/<canal>. Lista con lo no leído
// (hub.chat_resumen), conversación que se refresca cada 4 s mientras está a la
// vista, directos (hub.chat_directo), canales de grupo y los de cada ficha
// (hub.chat_ficha, con enlace de vuelta). Prefijo de ids: ch-.
import { API } from '../../core/api';
import { usuario, esAdmin } from '../../core/estado';
import { equipo, nombreDe } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { markdown } from '../../ui/markdown';

interface Canal { id: string; nombre: string | null; tipo: 'grupo' | 'directo' | 'ficha'; miembros: string[]; ultimo_at: string; sin_leer: number; ultimo_texto: string | null }
interface Mensaje { id: string; canal_id: string; autor_id: string | null; texto: string; created_at: string; editado_at: string | null }
let _canal: string | null = null;
let _timer = 0;
let _ultimo = '';

const nombreCanal = (c: Canal) => c.tipo === 'grupo' ? `# ${c.nombre ?? 'grupo'}` : c.tipo === 'ficha' ? c.nombre ?? 'Ficha' : nombreDe(c.miembros.find(m => m !== usuario()?.id)) || 'directo';
// Una conversación directa lleva delante el icono de persona (HTML, fuera del esc).
const icoCanal = (c: Canal) => c.tipo === 'grupo' || c.tipo === 'ficha' ? '' : `${ico('persona')} `;
const hora = (v: string) => { const d = new Date(v); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); };

function burbujas(ms: Mensaje[]): string {
  const yo = usuario()?.id;
  return ms.map(m => `<article class="ch-msg ${m.autor_id === yo ? 'ch-mio' : ''}"><header><strong>${esc(nombreDe(m.autor_id) || '—')}</strong> <small class="nota">${esc(hora(m.created_at))}${m.editado_at ? ' · editado' : ''}</small></header>
    <div class="md">${markdown(m.texto)}</div>${m.autor_id === yo || esAdmin() ? `<button class="ch-borrar" data-action="chBorrar" data-p0="${m.id}" aria-label="Borrar mensaje">✕</button>` : ''}</article>`).join('') || '<p class="vacio">Aún no hay mensajes. ¡Empieza tú!</p>';
}

async function refrescar() {
  if (!_canal || !document.getElementById('ch-mensajes')) { clearInterval(_timer); return; }
  const { data } = await API.get<Mensaje[]>('chat_mensajes', { select: '*', canal_id: `eq.${_canal}`, order: 'created_at.desc', limit: '100' });
  const ms = (data ?? []).reverse();
  const firma = ms.map(m => m.id + (m.editado_at ?? '')).join();
  if (firma === _ultimo) return;
  _ultimo = firma;
  const c = document.getElementById('ch-mensajes');
  if (!c) return;
  const abajo = c.scrollHeight - c.scrollTop - c.clientHeight < 80;
  c.innerHTML = burbujas(ms);
  if (abajo || !c.dataset.listo) { c.scrollTop = c.scrollHeight; c.dataset.listo = '1'; }
  if (usuario()?.id) await API.upsert('chat_leidos', 'canal_id,usuario_id', { canal_id: _canal, usuario_id: usuario()!.id, leido_hasta: new Date().toISOString() });
}

export async function pintar(el: HTMLElement, params: string[]) {
  clearInterval(_timer);
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [r, personas] = await Promise.all([API.rpc<Canal[]>('chat_resumen'), equipo()]);
  const canales = r.data ?? [];
  _canal = params[0] ?? (window.matchMedia('(min-width: 768px)').matches ? canales[0]?.id ?? null : null);
  _ultimo = '';
  const actual = canales.find(c => c.id === _canal);
  // Un canal de ficha lleva a la ficha (la ruta la guardó hub.chat_ficha).
  const ruta = actual?.tipo === 'ficha' ? (await API.single<{ ficha_ruta: string | null }>('chat_canales', { select: 'ficha_ruta', id: `eq.${actual.id}` })).data?.ficha_ruta ?? null : null;
  el.innerHTML = `<div class="ch-marco ${_canal ? 'ch-con-canal' : ''}">
    <aside class="tarjeta ch-lista"><ul>${canales.map(c => `<li><a href="#/chat/${c.id}" class="${c.id === _canal ? 'activo' : ''}"><span>${icoCanal(c)}${esc(nombreCanal(c))}</span>${c.sin_leer ? `<span class="chip aviso">${c.sin_leer}</span>` : ''}
        <small class="nota">${esc((c.ultimo_texto ?? '').slice(0, 50))}</small></a></li>`).join('') || '<li class="nota">Sin canales.</li>'}</ul>
      <form class="acciones" data-on-submit="chDirecto" data-prevent="1"><select id="ch-persona" aria-label="Persona"><option value="">Mensaje directo a…</option>${personas.filter(p => p.id !== usuario()?.id).map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select><button class="btn secundario" type="submit">Abrir</button></form>
      <form class="acciones" data-on-submit="chGrupo" data-prevent="1"><input id="ch-grupo" placeholder="Nuevo canal de grupo" maxlength="40" aria-label="Nombre del canal"><button class="btn secundario" type="submit">Crear</button></form></aside>
    <section class="tarjeta ch-conversacion">${actual ? `<header class="ch-cab"><a href="#/chat" class="ch-volver" aria-label="Volver a la lista">‹</a><h3>${icoCanal(actual)}${esc(nombreCanal(actual))}</h3>${ruta && /^#\/[a-z-]+\/[A-Za-z0-9-]+$/.test(ruta) ? `<a class="ch-ficha" href="${esc(ruta)}">Abrir la ficha →</a>` : ''}</header>
      <div id="ch-mensajes" class="ch-mensajes" aria-live="polite"></div>
      <form class="ch-escribir" data-on-submit="chEnviar" data-prevent="1"><textarea id="ch-texto" rows="2" maxlength="4000" placeholder="Escribe… (Intro envía, Mayús+Intro salta de línea)" data-on-keydown="chTecla:$event" aria-label="Mensaje"></textarea>
        <button class="btn" type="submit">Enviar</button></form>` : '<p class="vacio">Elige una conversación.</p>'}</section></div>`;
  if (actual) { await refrescar(); _timer = window.setInterval(refrescar, 4000); }
}

registrarAcciones({
  async chEnviar() {
    const t = document.getElementById('ch-texto') as HTMLTextAreaElement | null;
    const texto = t?.value.trim();
    if (!texto || !_canal) return;
    t!.value = '';
    const r = await API.post('chat_mensajes', { canal_id: _canal, texto });
    if (r.error) { toast(`No se pudo enviar: ${r.error.message}`, 'error'); t!.value = texto; return; }
    await refrescar();
    const c = document.getElementById('ch-mensajes'); if (c) c.scrollTop = c.scrollHeight;
  },
  chTecla(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (document.querySelector('.ch-escribir') as HTMLFormElement)?.requestSubmit(); }
  },
  async chDirecto() {
    const otro = (document.getElementById('ch-persona') as HTMLSelectElement).value;
    if (!otro) return;
    const r = await API.rpc<string>('chat_directo', { p_otro: otro });
    if (r.error) toast(r.error.message, 'error'); else ir('chat', String(r.data));
  },
  async chGrupo() {
    const nombre = (document.getElementById('ch-grupo') as HTMLInputElement).value.trim();
    if (!nombre) return;
    const r = await API.post<{ id: string }[]>('chat_canales', { nombre, tipo: 'grupo', creado_por: usuario()?.id });
    if (r.error || !r.data?.[0]) toast(`No se pudo: ${r.error?.message}`, 'error'); else ir('chat', r.data[0].id);
  },
  async chBorrar(id: string) {
    if (!confirm('¿Borrar el mensaje?')) return;
    const r = await API.delete('chat_mensajes', { id: `eq.${id}` });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { _ultimo = ''; await refrescar(); }
  },
});
void resolver;
