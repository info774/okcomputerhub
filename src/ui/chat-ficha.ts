// «💬 Chat» de una ficha (initGroupChatForOperation de la app): abre el canal
// de esa ficha en #/chat —lo crea la primera vez y apunta a quien entra,
// hub.chat_ficha— con nombre «emoji Tipo · título», como las salas de la app.
// El chat es del hub, así que funciona también antes del corte.
import { API } from '../core/api';
import { registrarAcciones } from '../core/dispatcher';
import { ir } from '../core/router';
import { esc, toast } from './dom';

export type TipoFicha = 'trabajo' | 'ticket' | 'tarea' | 'presupuesto' | 'oportunidad';
const ROTULO: Record<TipoFicha, string> = { trabajo: '🔧 Trabajo', ticket: '🎫 Ticket', tarea: '✅ Tarea', presupuesto: '📋 Presupuesto', oportunidad: '💡 Oportunidad' };

/** Botón para la barra de acciones de una ficha. `ruta` es su hash (`#/trabajos/151`). */
export function botonChatFicha(tipo: TipoFicha, id: string, titulo: string, ruta: string): string {
  return `<button class="btn secundario" data-action="chatFicha" data-p0="${esc(tipo)}" data-p1="${esc(id)}" data-p2="${esc(`${ROTULO[tipo]} · ${titulo}`.slice(0, 120))}" data-p3="${esc(ruta)}" title="Conversación del equipo sobre esta ficha">💬 Chat</button>`;
}

registrarAcciones({
  async chatFicha(tipo: string, id: string, nombre: string, ruta: string) {
    const r = await API.rpc<string>('chat_ficha', { p_tipo: tipo, p_id: id, p_nombre: nombre, p_ruta: ruta });
    if (r.error || !r.data) { toast(`No se pudo abrir el chat: ${r.error?.message ?? 'sin respuesta'}`, 'error'); return; }
    ir('chat', String(r.data));
  },
});
