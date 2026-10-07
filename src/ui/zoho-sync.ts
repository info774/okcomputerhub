// «Traer de Zoho» en Clientes, Presupuestos y Catálogo (los botones de sync
// de la app: sync-zoho, sync-zoho-estimates y sync-zoho-items), sobre la
// función `zoho-sync`. Solo se enseña con el área del hub: mientras sea de la
// app, lo trae la app y el hub lo copia. Página a página como la app (tope 20).
import { registrarAcciones } from '../core/dispatcher';
import { llamarFuncion } from '../core/funciones';
import { resolver } from '../core/router';
import { ico } from '../shell/linea';
import { toast, pl } from './dom';

export type QueZoho = 'clientes' | 'presupuestos' | 'articulos';

export const botonZoho = (que: QueZoho) =>
  `<button type="button" class="btn secundario" data-action="traerDeZoho" data-p0="${que}" title="Trae de Zoho Books lo nuevo y lo cambiado">${ico('repetir')} Traer de Zoho</button>`;

registrarAcciones({
  async traerDeZoho(que: string) {
    let nuevos = 0, cambiados = 0;
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await llamarFuncion<{ imported?: number; updated?: number; hasMore?: boolean; omitido?: boolean; motivo?: string }>(
        'zoho-sync', { accion: que, page }, 120000);
      if (error || !data) { toast(`Zoho no contestó: ${error ?? 'sin respuesta'}`, 'error'); break; }
      if (data.omitido) { toast(data.motivo ?? 'Esto se trae de Zoho desde la app.'); return; }
      nuevos += data.imported ?? 0; cambiados += data.updated ?? 0;
      if (!data.hasMore) break;
    }
    toast(`Zoho: ${pl(nuevos, 'nuevo', 'nuevos')} y ${pl(cambiados, 'actualizado', 'actualizados')}.`);
    window.dispatchEvent(new CustomEvent('hub:zoho', { detail: que }));
    resolver();
  },
});
