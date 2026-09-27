// Registro de módulos: el orden de aquí es el del menú y el de Inicio.
// Pantalla nueva = carpeta en src/modulos/ + entrada aquí (ver CLAUDE.md).
import type { Modulo } from '../core/modulo';
import { moduloInicio } from './inicio';
import { moduloDatos } from './datos';
import { moduloProyectos } from './proyectos';
import { modulosAppActual } from './app-actual';

export const MODULOS: Modulo[] = [
  moduloInicio,
  moduloProyectos,
  ...modulosAppActual,
  moduloDatos,
];
