// Reloj (Galaxy Watch, Wear OS): vincular el reloj con el código que enseña su
// pantalla y ver/desvincular los relojes. Lo que el reloj pinta lo sirve la
// función `reloj`; la app del reloj vive en la carpeta `reloj/` del repo
// (docs/RELOJ.md). Cada persona vincula los suyos; un admin ve todos.
// Prefijo de ids: rl-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { equipo, nombreDe } from '../../core/equipo';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { esc, fechaHora, hace, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';

interface Reloj { id: string; nombre: string | null; usuario_id: string; aprobado_at: string | null; ultimo_uso: string | null; revocado_at: string | null }

let _el: HTMLElement | null = null;

async function pintar(el: HTMLElement, params: string[] = []) {
  _el = el;
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [{ data, error }] = await Promise.all([
    API.get<Reloj[]>('reloj_dispositivos', { select: 'id,nombre,usuario_id,aprobado_at,ultimo_uso,revocado_at', order: 'aprobado_at.desc' }),
    equipo(),  // para nombreDe()
  ]);
  if (error) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los relojes: ${esc(error.message)}</p>`; return; }
  const relojes = data ?? [];
  const yo = usuario();
  // #/reloj/K7M-4QP: el código ya viene puesto (enlace que enseña el reloj).
  const codigo = (params[0] ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 7);
  el.innerHTML = `
    <section class="tarjeta">
      <h2>Vincular un reloj</h2>
      <p>Abre <b>Ok Hub</b> en el reloj: enseña un código de 6 letras y números. Escríbelo aquí (caduca a los 10 minutos).</p>
      <form data-on-submit="rlAprobar" data-prevent="1">
        <div class="pr-campos">
          <label>Código del reloj <input id="rl-codigo" maxlength="7" autocomplete="off" autocapitalize="characters"
            placeholder="K7M-4QP" required value="${esc(codigo)}" style="text-transform:uppercase;letter-spacing:.15em"></label>
          <label>Nombre <input id="rl-nombre" maxlength="60" placeholder="Galaxy Watch de ${esc((yo?.nombre ?? '').split(' ')[0])}"></label>
        </div>
        <button class="btn" type="submit">Vincular</button>
      </form>
      <p class="nota">El reloj actúa en tu nombre: ve tus avisos y tu día, ficha y manda comandas como tú. Si lo pierdes, desvincúlalo aquí.</p>
    </section>
    <section class="tarjeta">
      <h2>Relojes vinculados</h2>
      <table class="tabla"><thead><tr><th>Nombre</th><th>De</th><th>Vinculado</th><th>Último uso</th><th>Estado</th><th></th></tr></thead>
      <tbody>${relojes.map(r => `<tr>
        <td>${ico('smartwatch')} ${esc(r.nombre ?? 'Reloj')}</td><td>${esc(nombreDe(r.usuario_id))}</td>
        <td>${esc(r.aprobado_at ? fechaHora(r.aprobado_at) : '—')}</td><td>${esc(r.ultimo_uso ? hace(r.ultimo_uso) : 'nunca')}</td>
        <td>${r.revocado_at ? '<span class="chip mal">Desvinculado</span>' : '<span class="chip bien">Activo</span>'}</td>
        <td>${r.revocado_at ? '' : `<button class="btn peligro" data-action="rlRevocar" data-p0="${esc(r.id)}" data-p1="${esc(r.nombre ?? 'Reloj')}">Desvincular</button>`}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="vacio">Todavía no hay ningún reloj vinculado.</td></tr>'}</tbody></table>
    </section>`;
}

const repintar = () => { if (_el) void pintar(_el); };

registrarAcciones({
  async rlAprobar() {
    const codigo = (document.getElementById('rl-codigo') as HTMLInputElement).value.trim();
    const nombre = (document.getElementById('rl-nombre') as HTMLInputElement).value.trim();
    const { error } = await API.rpc<string>('reloj_aprobar', { p_codigo: codigo, p_nombre: nombre || null });
    if (error) { toast(error.message, 'error'); return; }
    toast('Reloj vinculado: en unos segundos se pone al día');
    if (location.hash !== '#/reloj') location.hash = '#/reloj'; else repintar();
  },
  async rlRevocar(id: string, nombre: string) {
    if (!confirm(`¿Desvincular «${nombre}»? Dejará de ver el hub al momento.`)) return;
    const { error } = await API.rpc('reloj_revocar', { p_id: id });
    if (error) { toast(`No se pudo desvincular: ${error.message}`, 'error'); return; }
    toast('Reloj desvinculado');
    repintar();
  },
});

async function contador(): Promise<Contador | null> {
  const n = await API.contar('reloj_dispositivos', { revocado_at: 'is.null', usuario_id: `eq.${usuario()?.id}` });
  return n == null ? null : { valor: n, subtitulo: n === 1 ? 'reloj vinculado' : 'relojes vinculados' };
}

export const moduloReloj: Modulo = {
  id: 'reloj',
  titulo: 'Reloj',
  grupo: 'Sistema',
  icono: '⌚',
  explicacion: 'El hub en el Galaxy Watch: avisos, tu día, monitorización y cifras de un vistazo, fichar y dictar comandas. Aquí se vincula el reloj con el código que enseña su pantalla y se desvincula si se pierde.',
  pintar,
  contador,
};
