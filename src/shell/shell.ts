// El shell: menú por grupos, cabecera (buscador, tema, tour, usuario) y el
// hueco de la pantalla con su párrafo explicativo. Con el modo escritorio
// activo (shell/escritorio.ts), la pantalla no va a #pantalla sino a una
// ventana; el shell clásico queda pintado debajo, escondido por CSS.
import type { Modulo } from '../core/modulo';
import { esc } from '../ui/dom';
import { usuario } from '../core/estado';
import { visibles, hrefDe } from '../modulos/inicio';
import { pintarPantalla } from './pantalla';
import { escritorioActivo, pintarEscritorio, mostrarEnEscritorio } from './escritorio';

export function pintarShell(raiz: HTMLElement) {
  const u = usuario();
  raiz.innerHTML = `
    <header class="cabecera">
      <button class="icono-btn solo-movil" data-action="alternarMenu" aria-label="Menú">☰</button>
      <a class="marca" href="#/inicio"><span class="hex" aria-hidden="true">OK</span>Ok Computer <b>Hub</b></a>
      <button id="buscador-btn" class="buscador-btn" data-action="abrirBuscador" aria-label="Buscar"><span aria-hidden="true">🔎</span><span class="btn-label"> Buscar o pedir algo…</span> <kbd>Ctrl K</kbd></button>
      <span class="hueco"></span>
      <button id="tema-btn" class="icono-btn" data-action="alternarTema" aria-label="Tema claro u oscuro">🌓</button>
      <button class="icono-btn" data-action="empezarTour" aria-label="Tour">?</button>
      <span class="usuario" title="${esc(u?.email)}">${esc(u?.nombre ?? u?.email ?? '')}</span>
      <button class="btn secundario" data-action="salir">Salir</button>
    </header>
    <div class="cuerpo">
      <nav id="menu" class="menu" aria-label="Pantallas"></nav>
      <main class="principal">
        <h1 id="pantalla-titulo"></h1>
        <p id="pantalla-explicacion" class="explicacion"></p>
        <div id="pantalla"></div>
      </main>
    </div>
    <dialog id="buscador" class="buscador" data-on-keydown="buscadorTecla:$event" data-key="Escape|Tab">
      <div class="bus-modos" role="tablist" id="bus-modos"></div>
      <input id="bus-campo" type="search" placeholder="¿Qué pantalla?" autocomplete="off"
        data-on-input="filtrarBuscador:$value" data-on-keyup="buscadorEnter" data-key="Enter">
      <ul id="bus-resultados"></ul>
      <p class="bus-pie"><kbd>Tab</kbd> cambia de modo · <kbd>↵</kbd> abre · <kbd>Esc</kbd> cierra</p>
    </dialog>`;
  pintarMenu();
  if (escritorioActivo()) pintarEscritorio(raiz);
}

function pintarMenu() {
  const lista = [...visibles()];
  const inicio = { id: 'inicio', titulo: 'Inicio', icono: '🏠', grupo: 'General' } as Modulo;
  const todos = [inicio, ...lista];
  const grupos = [...new Set(todos.map(m => m.grupo))];
  document.getElementById('menu')!.innerHTML = grupos.map(g => `
    <div class="menu-grupo"><h4>${esc(g)}</h4>
      ${todos.filter(m => m.grupo === g).map(m => `
        <a class="menu-item" data-mod="${esc(m.id)}" href="${esc(hrefDe(m))}"${m.enlaceExterno ? ' target="_blank" rel="noopener"' : ''}>
          <span aria-hidden="true">${esc(m.icono)}</span> ${esc(m.titulo)}${m.enlaceExterno ? ' <small>↗</small>' : ''}
        </a>`).join('')}
    </div>`).join('')
    + `<button class="menu-escritorio" data-action="osEntrar">🖥 Modo escritorio</button>`;
}

export async function mostrarModulo(m: Modulo, params: string[]) {
  document.body.classList.remove('menu-abierto');
  document.querySelectorAll('.menu-item').forEach(a => a.classList.toggle('activo', (a as HTMLElement).dataset.mod === m.id));
  document.title = `${m.titulo} · Ok Computer Hub`;
  if (escritorioActivo()) { await mostrarEnEscritorio(m, params); return; }
  document.getElementById('pantalla-titulo')!.textContent = m.titulo;
  document.getElementById('pantalla-explicacion')!.textContent = m.explicacion;
  await pintarPantalla(document.getElementById('pantalla')!, m, params);
}

export function alternarMenu() { document.body.classList.toggle('menu-abierto'); }
