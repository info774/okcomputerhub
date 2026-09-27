// Tema claro/oscuro. Sin preferencia guardada, manda la del sistema.
const CLAVE = 'hub_tema';

function guardado(): 'claro' | 'oscuro' | null {
  try { const v = localStorage.getItem(CLAVE); return v === 'claro' || v === 'oscuro' ? v : null; } catch { return null; }
}

export function aplicarTema() {
  const t = guardado();
  if (t) document.documentElement.dataset.theme = t === 'oscuro' ? 'dark' : 'light';
  else delete document.documentElement.dataset.theme;
}

export function alternarTema() {
  const oscuroAhora = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  try { localStorage.setItem(CLAVE, oscuroAhora ? 'claro' : 'oscuro'); } catch { /* sin almacenamiento */ }
  aplicarTema();
}
