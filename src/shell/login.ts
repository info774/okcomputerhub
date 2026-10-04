// Pantalla de entrada: correo y contraseña, o Google (mismo Client ID del
// proyecto GCP 508620194342, con la redirect del hub añadida: docs/FASE0.md).
import { esc } from '../ui/dom';

export function pintarLogin(raiz: HTMLElement, aviso = '') {
  raiz.innerHTML = `
    <main class="login">
      <form class="tarjeta" data-on-submit="entrar" data-prevent="1">
        <h1>Ok Computer <b>Hub</b></h1>
        ${aviso ? `<p class="aviso mal" id="lg-aviso">${esc(aviso)}</p>` : '<p class="aviso" id="lg-aviso" hidden></p>'}
        <label>Correo <input id="lg-email" type="email" autocomplete="username" required></label>
        <label>Contraseña <input id="lg-pass" type="password" autocomplete="current-password" required></label>
        <button class="btn" type="submit">Entrar</button>
        <button class="btn secundario" type="button" data-action="entrarGoogle">Entrar con Google</button>
        <p class="nota"><a href="/privacidad.html" target="_blank" rel="noopener">Política de privacidad</a></p>
      </form>
    </main>`;
}

export function avisoLogin(msg: string) {
  const el = document.getElementById('lg-aviso');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.className = 'aviso mal';
}
