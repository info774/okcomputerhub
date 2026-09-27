// Registro de módulos: el orden de aquí es el del menú y el de Inicio.
// Pantalla nueva = carpeta en src/modulos/ + entrada aquí (ver CLAUDE.md).
import type { Modulo } from '../core/modulo';
import { moduloInicio } from './inicio';
import { moduloDireccion } from './direccion';
import { moduloInformes } from './informes';
import { moduloDatos } from './datos';
import { moduloConector } from './conector';
import { moduloProyectos } from './proyectos';
import { moduloMonitorizacion } from './monitorizacion';
import { moduloClientes } from './clientes';
import { moduloOportunidades } from './oportunidades';
import { moduloCobros } from './cobros';
import { moduloMapa } from './mapa';
import { modulosAppActual } from './app-actual';

export const MODULOS: Modulo[] = [
  moduloInicio,
  moduloDireccion,
  moduloInformes,
  moduloProyectos,
  moduloClientes,
  moduloOportunidades,
  moduloCobros,
  moduloMapa,
  moduloMonitorizacion,
  ...modulosAppActual,
  moduloDatos,
  moduloConector,
];
