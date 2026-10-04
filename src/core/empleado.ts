// Modo empleado (paridad bloque 6, portado de ui/empleado.js de la app): quien
// NO es admin ve el menú reducido del técnico de calle. Es SOLO interfaz: los
// datos los protege la RLS; una pantalla fuera del menú sigue abriendo por URL,
// como en la app. Las de la app (Hoy, Lista del día, Calendario, Trabajos,
// Tareas, Sitios, Contactos, Inventario, Chat y Mis horas = Personas) más las
// del hub que son del técnico: comandas, tablero, wiki, buscador, reloj y
// monitorización (en la app, la pestaña «Monitor.» de cada sitio).
import { usuario } from './estado';

export const MENU_EMPLEADO = new Set([
  'inicio', 'hoy', 'lista-dia', 'calendario', 'trabajos', 'tareas', 'sitios', 'contactos', 'inventario', 'chat', 'personas',
  'comandas', 'tablero', 'wiki', 'buscar', 'reloj', 'monitorizacion',
]);

export const esEmpleado = () => !!usuario()?.rol && usuario()!.rol !== 'admin';

export const enMenuEmpleado = (id: string) => !esEmpleado() || MENU_EMPLEADO.has(id);
