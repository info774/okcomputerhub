// Firmas (fase 10): cualquier documento para firmar desde el móvil —actas de
// entrega, autorizaciones, anexos…— con su enlace público (firmar.html?t=…).
// La huella del texto se fija al crearlo y se comprueba al firmar; lo firmado
// no se toca. Evidencias: nombre, DNI, hora, IP, navegador y la firma dibujada.
// Prefijo de ids: fi-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { esAdmin, usuario } from '../../core/estado';
import { nombreDe } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast, hace, fechaHora } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { markdown } from '../../ui/markdown';
import { buscarClientes, nombresClientes } from '../ventas/datos';

interface Firma { id: string; created_at: string; creado_por: string | null; titulo: string; contenido: string; contenido_hash: string; cliente_id: string | null;
  firmante_nombre: string | null; firmante_email: string | null; token: string; caduca_at: string; estado: string; firmado_at: string | null; firma_img: string | null;
  firmado_nombre: string | null; firmado_dni: string | null; firmado_ip: string | null; firmado_ua: string | null; enviado_at: string | null }
const TONO: Record<string, string> = { pendiente: 'aviso', firmado: 'bien', anulado: '' };
const enlace = (f: Firma) => `${location.origin}/firmar.html?t=${f.token}`;
let _actual: Firma | null = null;
let _timer = 0;

async function vistaLista(): Promise<string> {
  const { data } = await API.get<Firma[]>('firmas', { select: 'id,created_at,titulo,firmante_nombre,estado,firmado_at,caduca_at,cliente_id,creado_por', order: 'created_at.desc', limit: '200' });
  const nombres = await nombresClientes((data ?? []).map(f => f.cliente_id));
  return `<div class="acciones pr-barra"><a class="btn" href="#/firmas/nueva">+ Documento para firmar</a></div>
    <div class="tarjeta mo-scroll">${(data ?? []).length ? `<table class="tabla"><thead><tr><th>Documento</th><th>Firmante</th><th>Estado</th><th>Cuándo</th></tr></thead><tbody>
    ${(data ?? []).map(f => `<tr class="fila-clic" data-action="fiAbrir" data-p0="${f.id}"><td><strong>${esc(f.titulo)}</strong>${f.cliente_id ? `<br><small class="nota">${esc(nombres.get(f.cliente_id) ?? '')}</small>` : ''}</td>
      <td>${esc(f.firmante_nombre ?? '')}</td><td><span class="chip ${TONO[f.estado] ?? ''}">${esc(f.estado)}</span>${f.estado === 'pendiente' && f.caduca_at < new Date().toISOString() ? ' <span class="chip mal">caducado</span>' : ''}</td>
      <td>${esc(f.firmado_at ? `firmado ${hace(f.firmado_at)}` : `creado ${hace(f.created_at)}`)}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Nada todavía.</p>'}</div>`;
}

function formulario(f: Partial<Firma>, clienteNombre = ''): string {
  return `<form class="tarjeta" data-on-submit="fiGuardar" data-prevent="1">
    <label>Título <input id="fi-titulo" required maxlength="200" value="${esc(f.titulo ?? '')}" placeholder="p. ej. Acta de entrega de equipos"></label>
    <div class="in-campos"><label>Cliente <input id="fi-cliente-q" autocomplete="off" value="${esc(clienteNombre)}" placeholder="Opcional" data-on-input="fiBuscarCliente:$value"></label>
      <label>Firmante <input id="fi-nombre" value="${esc(f.firmante_nombre ?? '')}" placeholder="Nombre de quien firma"></label>
      <label>Su correo <input id="fi-email" type="email" value="${esc(f.firmante_email ?? '')}"></label>
      <label>Caduca en (días) <input id="fi-dias" type="number" min="1" max="365" value="30"></label></div>
    <input type="hidden" id="fi-cliente" value="${esc(f.cliente_id ?? '')}"><ul id="fi-cliente-res" class="resultados"></ul>
    <div class="wk-dos"><label>Texto (markdown: # títulos, **negrita**, - listas)<textarea id="fi-contenido" rows="16" required data-on-input="fiPrevia:$value">${esc(f.contenido ?? '')}</textarea></label>
      <div><span class="nota">Así lo verá</span><article id="fi-previa" class="tarjeta md">${markdown(f.contenido ?? '')}</article></div></div>
    <p class="nota">Cambiar el texto de uno ya enviado invalida el enlace anterior (hay que mandar el nuevo).</p>
    <div class="acciones"><button class="btn" type="submit">${f.id ? 'Guardar' : 'Crear'}</button></div></form>`;
}

async function vistaFicha(id: string): Promise<string> {
  const { data: f } = await API.single<Firma>('firmas', { select: '*', id: `eq.${id}` });
  if (!f) return '<p class="aviso mal">No existe ese documento.</p>';
  _actual = f;
  const cliente = f.cliente_id ? (await nombresClientes([f.cliente_id])).get(f.cliente_id) ?? '' : '';
  const puede = esAdmin() || f.creado_por === usuario()?.id;
  if (f.estado === 'pendiente' && puede && location.hash.endsWith('/editar')) return `<p><a href="#/firmas/${f.id}">← Volver</a></p><h2>Editar</h2>${formulario(f, cliente)}`;
  return `<p><a href="#/firmas">← Firmas</a></p>
    <div class="tarjeta-cab"><h2>${ico('firma')} ${esc(f.titulo)}</h2><span class="chip ${TONO[f.estado] ?? ''}">${esc(f.estado)}</span></div>
    <p class="nota">Creado ${esc(hace(f.created_at))} por ${esc(nombreDe(f.creado_por))}${cliente ? ` · ${esc(cliente)}` : ''} · huella <code>${esc(f.contenido_hash.slice(0, 16))}…</code></p>
    ${f.estado === 'pendiente' ? `<section class="tarjeta"><h3>Enlace para ${esc(f.firmante_nombre ?? 'el firmante')}</h3>
      <p><input readonly id="fi-enlace" value="${esc(enlace(f))}" aria-label="Enlace para firmar"></p>
      <p class="nota">Vale hasta el ${esc(fechaHora(f.caduca_at))}${f.enviado_at ? ` · enviado por correo ${esc(hace(f.enviado_at))}` : ''}.</p>
      <div class="acciones"><button class="btn secundario" data-action="fiCopiar">Copiar enlace</button>
        ${f.firmante_email ? `<button class="btn" data-action="fiEnviar">Mandar por correo a ${esc(f.firmante_email)}</button>` : ''}
        ${puede ? `<a class="btn secundario" href="#/firmas/${f.id}/editar">Editar</a><button class="btn peligro" data-action="fiAnular">Anular</button>` : ''}</div></section>` : ''}
    ${f.estado === 'firmado' ? `<section class="tarjeta fi-evidencias"><h3>Firmado</h3><dl class="tk-dl">
      <dt>Firmó</dt><dd>${esc(f.firmado_nombre)}${f.firmado_dni ? ` · DNI ${esc(f.firmado_dni)}` : ''}</dd>
      <dt>Cuándo</dt><dd>${esc(fechaHora(f.firmado_at))}</dd><dt>Desde</dt><dd>IP ${esc(f.firmado_ip ?? '—')}<br><small class="nota">${esc(f.firmado_ua ?? '')}</small></dd>
      <dt>Huella del texto</dt><dd><code>${esc(f.contenido_hash)}</code></dd></dl>
      ${f.firma_img?.startsWith('data:image/png;base64,') ? `<img class="fi-firma" src="${esc(f.firma_img)}" alt="Firma de ${esc(f.firmado_nombre)}">` : ''}
      <div class="acciones no-imprimir"><button class="btn secundario" data-action="fiImprimir">Imprimir o guardar en PDF</button></div></section>` : ''}
    <article class="tarjeta md">${markdown(f.contenido)}</article>`;
}

async function pintar(el: HTMLElement, params: string[]) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [a] = params;
  el.innerHTML = a === 'nueva' ? `<p><a href="#/firmas">← Firmas</a></p><h2>Documento para firmar</h2>${formulario({})}` : a ? await vistaFicha(a) : await vistaLista();
  if (a === 'nueva') _actual = null;
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

registrarAcciones({
  fiAbrir(id: string) { ir('firmas', id); },
  fiPrevia(v: string) { const c = document.getElementById('fi-previa'); if (c) c.innerHTML = markdown(v); },
  fiBuscarCliente(q: string) {
    clearTimeout(_timer);
    (document.getElementById('fi-cliente') as HTMLInputElement).value = '';
    _timer = window.setTimeout(async () => {
      const ul = document.getElementById('fi-cliente-res');
      if (ul) ul.innerHTML = (await buscarClientes(q)).map(c => `<li><button type="button" class="btn secundario" data-action="fiElegirCliente" data-p0="${c.id}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}</button></li>`).join('');
    }, 250);
  },
  fiElegirCliente(id: string, nombre: string) {
    (document.getElementById('fi-cliente') as HTMLInputElement).value = id;
    (document.getElementById('fi-cliente-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('fi-cliente-res'); if (ul) ul.innerHTML = '';
  },
  async fiGuardar() {
    const d = { titulo: val('fi-titulo'), contenido: (document.getElementById('fi-contenido') as HTMLTextAreaElement).value, cliente_id: val('fi-cliente') || null,
      firmante_nombre: val('fi-nombre') || null, firmante_email: val('fi-email').toLowerCase() || null,
      caduca_at: new Date(Date.now() + (Number(val('fi-dias')) || 30) * 86400000).toISOString() };
    const r = _actual ? await API.patch('firmas', { id: `eq.${_actual.id}` }, d) : await API.post<Firma[]>('firmas', d);
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Guardado');
    ir('firmas', _actual?.id ?? (r.data as Firma[])[0].id);
  },
  async fiCopiar() {
    if (!_actual) return;
    try { await navigator.clipboard.writeText(enlace(_actual)); toast('Enlace copiado: mándalo por WhatsApp o correo'); } catch { (document.getElementById('fi-enlace') as HTMLInputElement).select(); }
  },
  async fiEnviar() {
    if (!_actual) return;
    const r = await llamarFuncion<{ para: string }>('firma', { accion: 'enviar', id: _actual.id });
    toast(r.error ? `No se pudo mandar: ${r.error}` : `Enviado a ${r.data?.para}`, r.error ? 'error' : 'info');
    if (!r.error) resolver();
  },
  async fiAnular() {
    if (!_actual || !confirm('¿Anular este documento? El enlace deja de valer.')) return;
    const r = await API.patch('firmas', { id: `eq.${_actual.id}` }, { estado: 'anulado' });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  fiImprimir() { window.print(); },
});

async function contador(): Promise<Contador | null> {
  const n = await API.contar('firmas', { estado: 'eq.pendiente' });
  return n == null ? null : { valor: n, subtitulo: 'documentos esperando firma', tono: n ? 'aviso' : 'neutro' };
}

export const moduloFirmas: Modulo = {
  id: 'firmas',
  titulo: 'Firmas',
  grupo: 'Clientes',
  icono: '✍️',
  explicacion: 'Documentos para que alguien los firme desde el móvil: actas de entrega, autorizaciones, anexos… Se manda el enlace, firma con el dedo y queda la prueba (quién, cuándo, desde dónde y la huella del texto que aceptó).',
  pintar,
  contador,
};
