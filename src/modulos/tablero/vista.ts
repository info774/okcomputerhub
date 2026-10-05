// Tablero de notas (tablero.js de la app): #/tablero. Rejilla de notas con
// buscador; nueva, editar y nota de voz en el mismo formulario (título
// opcional: sale de las primeras palabras, como en la app, porque `titulo` es
// obligatorio en la tabla). Todos ven todas; editar y borrar, solo las propias
// (RLS «propias»). Espejo del área `conocimiento`: con dueño `app` se ve y no
// se escribe. Prefijo de ids: tb-.
import { API } from '../../core/api';
import { usuario } from '../../core/estado';
import { equipo, nombreDe } from '../../core/equipo';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast, hace, fechaHora } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { markdown } from '../../ui/markdown';
import { alternarDictado, puedeDictar } from '../../ui/dictado';

interface Nota { id: string; user_id: string | null; titulo: string; descripcion: string | null; created_at: string; updated_at: string | null }
let _notas: Nota[] = [];
let _q = '';
let _escribe = false;
let _editando: string | null = null;

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function tarjetas(): string {
  const q = norm(_q.trim());
  const yo = usuario()?.id;
  const xs = q ? _notas.filter(n => norm(n.titulo).includes(q) || norm(n.descripcion).includes(q)) : _notas;
  return xs.map(n => `<article class="tarjeta tb-nota" data-id="${esc(n.id)}"><h3>${esc(n.titulo)}</h3>${n.descripcion ? `<div class="md">${markdown(n.descripcion)}</div>` : ''}
    <footer><small class="nota" title="${esc(fechaHora(n.created_at))}">${esc(nombreDe(n.user_id) || '—')} · ${esc(hace(n.created_at))}</small>
      ${_escribe && n.user_id === yo ? `<span><button class="icono-btn pequeno" data-action="tbEditar" data-p0="${esc(n.id)}" aria-label="Editar la nota">${ico('editar')}</button>
        <button class="icono-btn pequeno" data-action="tbBorrar" data-p0="${esc(n.id)}" aria-label="Borrar la nota">✕</button></span>` : ''}</footer></article>`).join('')
    || `<p class="vacio">${q ? 'Ninguna nota con eso.' : `Sin notas.${_escribe ? ' Pulsa «+ Nueva nota» para empezar.' : ''}`}</p>`;
}

function formulario(n: Nota | null): string {
  return `<form class="tarjeta tb-form" id="tb-form" data-on-submit="tbGuardar" data-prevent="1">
    <h3>${n ? 'Editar nota' : 'Nueva nota'}</h3>
    <label>Título <span class="nota">(opcional)</span> <input id="tb-titulo" maxlength="200" value="${esc(n?.titulo ?? '')}"></label>
    <label>Nota <textarea id="tb-desc" rows="4">${esc(n?.descripcion ?? '')}</textarea></label>
    <div class="acciones">${puedeDictar() ? `<button type="button" class="btn secundario" id="tb-dictar" data-action="tbDictar" aria-pressed="false">${ico('micro')} Dictar</button>` : ''}
      <button class="btn" type="submit">${n ? 'Guardar' : 'Añadir'}</button><button type="button" class="btn secundario" data-action="tbCancelar">Cancelar</button></div></form>`;
}

export async function pintar(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [r, escribe] = await Promise.all([API.get<Nota[]>('tablero_notas', { select: '*', order: 'created_at.desc' }), esDelHub('tablero_notas'), equipo()]);
  _notas = r.data ?? [];
  _escribe = escribe;
  _editando = null;
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('El tablero')}
    <div class="acciones tb-barra"><input id="tb-q" type="search" placeholder="Buscar en las notas…" value="${esc(_q)}" data-on-input="tbBuscar:$value" aria-label="Buscar nota">
      ${escribe ? `<button class="btn" data-action="tbNueva">+ Nueva nota</button>${puedeDictar() ? `<button class="btn secundario" data-action="tbVoz">${ico('micro')} Nota de voz</button>` : ''}` : ''}</div>
    <div id="tb-hueco"></div>
    <div class="tb-rejilla" id="tb-rejilla">${tarjetas()}</div>`;
}

function abrirFormulario(n: Nota | null) {
  _editando = n?.id ?? null;
  const h = document.getElementById('tb-hueco');
  if (h) h.innerHTML = formulario(n);
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
registrarAcciones({
  tbBuscar(v: string) { _q = v; const g = document.getElementById('tb-rejilla'); if (g) g.innerHTML = tarjetas(); },
  tbNueva() { abrirFormulario(null); document.getElementById('tb-titulo')?.focus(); },
  // Nota de voz: el formulario vacío y el dictado ya grabando sobre la nota
  // (sin foco en el título: en el móvil abriría el teclado encima).
  tbVoz() { abrirFormulario(null); void alternarDictado(document.getElementById('tb-dictar'), 'tb-desc'); },
  tbDictar() { void alternarDictado(document.getElementById('tb-dictar'), 'tb-desc'); },
  tbEditar(id: string) { const n = _notas.find(x => x.id === id); if (n) { abrirFormulario(n); document.getElementById('tb-hueco')?.scrollIntoView({ block: 'nearest' }); } },
  tbCancelar() { _editando = null; const h = document.getElementById('tb-hueco'); if (h) h.innerHTML = ''; },
  async tbGuardar() {
    let titulo = val('tb-titulo');
    const descripcion = val('tb-desc');
    if (!titulo && !descripcion) { toast('Escribe o dicta algo primero', 'error'); return; }
    if (!titulo) { const primera = descripcion.split('\n')[0]; titulo = primera.length > 60 ? `${primera.slice(0, 60).trimEnd()}…` : primera; }
    const r = _editando
      ? await API.patch('tablero_notas', { id: `eq.${_editando}` }, { titulo, descripcion: descripcion || null, updated_at: new Date().toISOString() })
      : await API.post('tablero_notas', { titulo, descripcion: descripcion || null, user_id: usuario()?.id });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    toast(_editando ? 'Nota guardada' : 'Nota añadida');
    resolver();
  },
  async tbBorrar(id: string) {
    if (!confirm('¿Borrar esta nota?')) return;
    const r = await API.delete('tablero_notas', { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Nota borrada');
    resolver();
  },
});
