// Registro de módulos: el orden de aquí es el del menú y el de Inicio.
// Pantalla nueva = carpeta en src/modulos/ + entrada aquí (ver CLAUDE.md).
import type { Modulo } from '../core/modulo';
import { moduloInicio } from './inicio';
import { moduloDireccion } from './direccion';
import { moduloInformes } from './informes';
import { moduloDatos } from './datos';
import { moduloConector } from './conector';
import { moduloProyectos } from './proyectos';
import { moduloWiki } from './wiki';
import { moduloBuscar } from './buscar';
import { moduloMonitorizacion } from './monitorizacion';
import { moduloClientes } from './clientes';
import { moduloOportunidades } from './oportunidades';
import { moduloTickets } from './tickets';
import { moduloPortal } from './portal';
import { moduloCobros } from './cobros';
import { moduloMapa } from './mapa';
import { modulosAppActual } from './app-actual';

export const MODULOS: Modulo[] = [
  moduloInicio,
  moduloDireccion,
  moduloInformes,
  moduloProyectos,
  moduloWiki,
  moduloBuscar,
  moduloClientes,
  moduloOportunidades,
  moduloTickets,
  moduloPortal,
  moduloCobros,
  moduloMapa,
  moduloMonitorizacion,
  ...modulosAppActual,
  moduloDatos,
  moduloConector,
];
