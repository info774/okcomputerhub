// Menú «Más» de las fichas: un <details class="menu-mas"> con las acciones
// secundarias, para que la barra de una ficha no tenga doce botones. Se cierra
// al pulsar fuera, al elegir una acción o con Esc (un <details> solo se cierra
// pulsando su propio resumen).
document.addEventListener('click', e => {
  const t = e.target as Element | null;
  document.querySelectorAll<HTMLDetailsElement>('details.menu-mas[open]').forEach(d => {
    if (!d.contains(t) || (t?.closest('.menu-mas-lista a, .menu-mas-lista button'))) d.open = false;
  });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll<HTMLDetailsElement>('details.menu-mas[open]').forEach(d => { d.open = false; });
});

// El desplegable con su resumen: «Más» y las acciones dentro.
export const menuMas = (contenido: string, rotulo = 'Más') => contenido.trim()
  ? `<details class="menu-mas"><summary class="btn secundario">${rotulo}<span class="menu-mas-flecha" aria-hidden="true"></span></summary><div class="menu-mas-lista">${contenido}</div></details>`
  : '';
