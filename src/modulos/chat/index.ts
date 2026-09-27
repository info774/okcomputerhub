// Chat del hub (fase Final): canales de grupo y directos. Se carga bajo demanda.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';

async function contador(): Promise<Contador | null> {
  const r = await API.rpc<{ sin_leer: number }[]>('chat_resumen');
  if (r.error) return null;
  const n = (r.data ?? []).reduce((a, c) => a + (c.sin_leer ?? 0), 0);
  return { valor: n, subtitulo: 'mensajes sin leer', tono: n ? 'aviso' : 'neutro' };
}

export const moduloChat: Modulo = {
  id: 'chat',
  titulo: 'Chat',
  grupo: 'Organizar',
  icono: '💬',
  explicacion: 'Hablar con el equipo: canales de grupo y mensajes directos. Es el chat del hub (el de la app sigue en la app hasta el cambio).',
  pintar: async (el, p) => (await import('./vista')).pintar(el, p),
  contador,
};
