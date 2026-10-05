// «Carpeta en Drive» de un cliente o una sede (paridad bloque 7, tanda 5:
// openClienteDriveFolder / openDriveLocal de la app). La función `google`
// busca la carpeta por nombre dentro de la carpeta compartida de la empresa y,
// si no está, la crea (cliente → sede, como la app). Se abre una pestaña en el
// mismo gesto y luego se le pone la dirección: así no la bloquea el navegador.
import { registrarAcciones } from '../core/dispatcher';
import { llamarFuncion } from '../core/funciones';
import { esc, toast } from './dom';
import { ico } from '../shell/linea';

export const botonDrive = (tipo: 'cliente' | 'local', id: string | null | undefined) => id
  ? `<button class="btn secundario" data-action="abrirDrive" data-p0="${tipo}" data-p1="${esc(id)}" title="Su carpeta en el Drive compartido de la empresa">${ico('carpeta')} Drive</button>` : '';

registrarAcciones({
  async abrirDrive(tipo: string, id: string) {
    const w = window.open('', '_blank');
    const r = await llamarFuncion<{ url?: string; error?: string; mensaje?: string }>('google', { accion: 'carpeta', [tipo === 'local' ? 'local_id' : 'cliente_id']: id }, 30000);
    if (r.data?.url) { if (w) w.location.href = r.data.url; else window.open(r.data.url, '_blank', 'noopener'); return; }
    w?.close();
    toast(r.data?.mensaje ?? r.error ?? 'No se pudo abrir la carpeta de Drive', 'error');
  },
});
