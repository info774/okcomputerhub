// Un alta que llega ya rellena desde otra pantalla (WhatsApp → ticket o
// trabajo, como `abrirAltaDesdeConv` / `continuarWhatsApp` de la app): quien
// la abre deja el borrador y navega; el formulario lo toma UNA vez al pintarse.
// Nada se crea solo: la persona lo repasa y guarda.
export interface Borrador {
  cliente_id?: string | null; local_id?: string | null; contacto_id?: string | null;
  titulo?: string; descripcion?: string; prioridad?: string;
  fecha?: string; hora?: string; tipo?: string; canal?: string;
  // Trabajo que nace de un ticket: al crearlo, el ticket queda enlazado y cerrado.
  ticket_id?: string; ticket_numero?: number;
}
export type Destino = 'ticket' | 'trabajo';

let _b: { destino: Destino; datos: Borrador; at: number } | null = null;

export function dejarBorrador(destino: Destino, datos: Borrador) {
  _b = { destino, datos, at: Date.now() };
}

/** El borrador para ese formulario, si lo hay y es reciente; se gasta al tomarlo. */
export function tomarBorrador(destino: Destino): Borrador | null {
  if (!_b || _b.destino !== destino || Date.now() - _b.at > 10 * 60_000) return null;
  const d = _b.datos;
  _b = null;
  return d;
}
