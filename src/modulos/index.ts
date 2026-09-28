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
import { moduloComandas } from './comandas';
import { moduloPersonas } from './personas';
import { moduloBuscar } from './buscar';
import { moduloMonitorizacion } from './monitorizacion';
import { moduloClientes } from './clientes';
import { moduloSitios } from './sitios';
import { moduloContactos } from './contactos';
import { moduloOportunidades } from './oportunidades';
import { moduloTickets } from './tickets';
import { moduloPortal } from './portal';
import { moduloFirmas } from './firmas';
import { moduloFacturacion } from './facturacion';
import { moduloCobros } from './cobros';
import { moduloMapa } from './mapa';
import { moduloAlmacen } from './almacen';
import { moduloTrabajos } from './trabajos';
import { moduloCalendario } from './calendario';
import { moduloChat } from './chat';
import { moduloHoy } from './hoy';
import { modulosAppActual } from './app-actual';

export const MODULOS: Modulo[] = [
  moduloInicio,
  moduloDireccion,
  moduloInformes,
  moduloProyectos,
  moduloComandas,
  moduloChat,
  moduloPersonas,
  moduloWiki,
  moduloBuscar,
  moduloClientes,
  moduloSitios,
  moduloContactos,
  moduloOportunidades,
  moduloTickets,
  moduloPortal,
  moduloFirmas,
  moduloCobros,
  moduloFacturacion,
  moduloMapa,
  moduloHoy,
  moduloTrabajos,
  moduloCalendario,
  moduloMonitorizacion,
  moduloAlmacen,
  ...modulosAppActual,
  moduloDatos,
  moduloConector,
];
