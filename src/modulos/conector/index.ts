// Conector MCP: tokens con los que Claude Code (u otra herramienta) lee y
// escribe en el hub a través de la función `mcp`. Solo admins. El token se
// enseña UNA vez al crearlo; en la base solo queda su huella.
// Prefijo de ids: cm-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { FUNCIONES_URL } from '../../core/config';
import { equipo, nombreDe } from '../../core/equipo';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { esc, fechaHora, hace, toast } from '../../ui/dom';

interface Token {
  id: string; created_at: string; nombre: string; prefijo: string; alcance: string; usuario_id: string;
  expira: string | null; ultimo_uso: string | null; revocado_at: string | null;
}

const URL_MCP = `${FUNCIONES_URL}/mcp`;
const ALCANCES: Record<string, string> = {
  lectura: 'Lectura — consulta todo, no cambia nada',
  escritura: 'Escritura — además crea y edita proyectos (lo de la app sigue en solo lectura)',
  admin: 'Admin — todo lo anterior y lo que se añada para administración',
};
let _el: HTMLElement | null = null;
let _recien: { token: string; nombre: string } | null = null;

const estado = (t: Token) => t.revocado_at ? ['mal', 'Revocado'] : t.expira && t.expira < new Date().toISOString() ? ['aviso', 'Caducado'] : ['bien', 'Activo'];

function comando(token: string) {
  return `claude mcp add okhub --transport http ${URL_MCP} --header "Authorization: Bearer ${token}"`;
}

async function pintar(el: HTMLElement) {
  _el = el;
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [{ data, error }, gente] = await Promise.all([
    API.get<Token[]>('mcp_tokens', { select: 'id,created_at,nombre,prefijo,alcance,usuario_id,expira,ultimo_uso,revocado_at', order: 'created_at.desc' }),
    equipo(),
  ]);
  if (error) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los tokens: ${esc(error.message)}</p>`; return; }
  const tokens = data ?? [];
  el.innerHTML = `
    ${_recien ? `<section class="tarjeta cm-recien">
      <h3>🔑 Token «${esc(_recien.nombre)}» creado</h3>
      <p class="aviso"><b>Cópialo ahora: no se vuelve a enseñar.</b> Si se pierde, se revoca y se crea otro.</p>
      <label>Token <input id="cm-token" readonly value="${esc(_recien.token)}"></label>
      <div class="acciones"><button class="btn" data-action="copiarCampo" data-p0="cm-token">Copiar token</button></div>
      <label>Para conectarlo a Claude Code (en una terminal)
        <textarea id="cm-comando" readonly rows="3">${esc(comando(_recien.token))}</textarea></label>
      <div class="acciones"><button class="btn secundario" data-action="copiarCampo" data-p0="cm-comando">Copiar comando</button>
        <button class="btn secundario" data-action="cmOcultar">Ya lo he guardado</button></div>
      <p class="nota">En este repositorio, <code>.mcp.json</code> ya apunta al conector: basta con poner el token en la variable de entorno <code>OKHUB_MCP_TOKEN</code>.</p>
    </section>` : ''}
    <section class="tarjeta">
      <h2>Crear token</h2>
      <form data-on-submit="cmCrear" data-prevent="1">
        <div class="pr-campos">
          <label>Nombre (para qué es) <input id="cm-nombre" maxlength="80" placeholder="p. ej. Claude Code de Fran" required></label>
          <label>Actúa en nombre de <select id="cm-usuario">${gente.map(u =>
            `<option value="${esc(u.id)}" ${u.id === usuario()?.id ? 'selected' : ''}>${esc(nombreDe(u.id))}</option>`).join('')}</select></label>
          <label>Caduca <select id="cm-dias"><option value="30">en 30 días</option><option value="90" selected>en 90 días</option>
            <option value="365">en un año</option><option value="">nunca</option></select></label>
        </div>
        <fieldset class="cm-alcance"><legend>Alcance</legend>
          ${Object.entries(ALCANCES).map(([k, v]) => `<label class="check"><input type="radio" name="cm-alcance" value="${k}" ${k === 'lectura' ? 'checked' : ''}> ${esc(v)}</label>`).join('')}
        </fieldset>
        <button class="btn" type="submit">Crear token</button>
      </form>
    </section>
    <section class="tarjeta">
      <h2>Tokens</h2>
      <table class="tabla"><thead><tr><th>Nombre</th><th>Empieza por</th><th>Alcance</th><th>En nombre de</th><th>Último uso</th><th>Caduca</th><th>Estado</th><th></th></tr></thead>
      <tbody>${tokens.map(t => { const [tono, txt] = estado(t); return `<tr>
        <td>${esc(t.nombre)}<br><small>creado ${esc(fechaHora(t.created_at))}</small></td>
        <td><code>${esc(t.prefijo)}…</code></td><td>${esc(t.alcance)}</td><td>${esc(nombreDe(t.usuario_id))}</td>
        <td>${esc(t.ultimo_uso ? hace(t.ultimo_uso) : 'nunca')}</td><td>${esc(t.expira ? fechaHora(t.expira) : 'nunca')}</td>
        <td><span class="chip ${tono}">${txt}</span></td>
        <td>${t.revocado_at ? '' : `<button class="btn peligro" data-action="cmRevocar" data-p0="${esc(t.id)}" data-p1="${esc(t.nombre)}">Revocar</button>`}</td>
      </tr>`; }).join('') || '<tr><td colspan="8" class="vacio">Todavía no hay tokens.</td></tr>'}</tbody></table>
    </section>`;
}

const repintar = () => { if (_el) void pintar(_el); };

registrarAcciones({
  async cmCrear() {
    const nombre = (document.getElementById('cm-nombre') as HTMLInputElement).value.trim();
    if (!nombre) return;
    const alcance = (document.querySelector('input[name="cm-alcance"]:checked') as HTMLInputElement)?.value ?? 'lectura';
    const dias = (document.getElementById('cm-dias') as HTMLSelectElement).value;
    const { data, error } = await API.rpc<string>('mcp_crear_token', {
      p_nombre: nombre, p_alcance: alcance, p_usuario_id: (document.getElementById('cm-usuario') as HTMLSelectElement).value,
      p_dias: dias ? Number(dias) : null,
    });
    if (error || !data) { toast(`No se pudo crear: ${error?.message ?? 'sin respuesta'}`, 'error'); return; }
    _recien = { token: data, nombre };
    repintar();
  },
  cmOcultar() { _recien = null; repintar(); },
  async cmRevocar(id: string, nombre: string) {
    if (!confirm(`¿Revocar el token «${nombre}»? Lo que lo use dejará de funcionar al momento.`)) return;
    const { error } = await API.rpc('mcp_revocar_token', { p_id: id });
    if (error) { toast(`No se pudo revocar: ${error.message}`, 'error'); return; }
    toast('Token revocado');
    repintar();
  },
  async copiarCampo(id: string) {
    const v = (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
    try { await navigator.clipboard.writeText(v); toast('Copiado'); }
    catch { (document.getElementById(id) as HTMLInputElement)?.select(); toast('Selecciónalo y cópialo a mano (Ctrl+C)'); }
  },
});

async function contador(): Promise<Contador | null> {
  const n = await API.contar('mcp_tokens', { revocado_at: 'is.null' });
  return n == null ? null : { valor: n, subtitulo: n === 1 ? 'token activo' : 'tokens activos' };
}

export const moduloConector: Modulo = {
  id: 'conector',
  titulo: 'Conector MCP',
  grupo: 'Sistema',
  icono: '🔌',
  soloAdmin: true,
  explicacion: 'Tokens para que Claude Code consulte y trabaje en el hub a través del conector MCP. Cada token tiene un alcance (lectura, escritura o admin), actúa en nombre de una persona y todo lo que escribe queda en el registro de cambios con su nombre. El token solo se ve al crearlo.',
  pintar,
  contador,
};
